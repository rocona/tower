import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import QRCode from 'qrcode';
import { CLIENT_MAP } from '../shared/clients.js';
import type {
  ClientTarget,
  ExportMode,
  ProxyNodeConfig,
  RoutingProfile,
  SecurityStatus,
  SourceRecord,
} from '../shared/types.js';
import { loadConfig, type AppConfig } from './config.js';
import { createDbClient, type DbClient } from './db/client.js';
import { createDefaultRoutingProfile } from './db/defaults.js';
import { TowerRepository, type ParsedNodeInput } from './db/repository.js';
import { SecretCipher, generateSecureToken } from './security/crypto.js';
import { MemoryRateLimiter } from './security/rateLimit.js';
import { SsrfBlockedError, safeFetchSubscription } from './security/ssrf.js';
import { AuthService } from './services/auth.js';
import { generateExport } from './services/exporter.js';
import { parseSubscriptionPayload } from './services/parser.js';
import {
  computeNodeFingerprint,
  normalizeHost,
  normalizePort,
  normalizeSha256Fingerprint,
  optionalSafeText,
  sanitizeNodeName,
} from './services/parserUtils.js';
import { probeNodesBatch } from './services/prober.js';
import { detectRegionAndMeta } from './services/regionDetector.js';

const SESSION_COOKIE = 'tower_session';
const ENCRYPTION_KEY_SETTING = 'internal_encryption_key';

const VALID_CLIENTS = new Set<ClientTarget>(Object.keys(CLIENT_MAP) as ClientTarget[]);

function isHttpsRequest(request: FastifyRequest): boolean {
  const forwarded = request.headers['x-forwarded-proto'];
  if (typeof forwarded === 'string') {
    return forwarded.split(',')[0].trim().toLowerCase() === 'https';
  }
  return request.protocol === 'https';
}

function resolvePublicBaseUrl(request: FastifyRequest, config: AppConfig): string {
  if (config.publicBaseUrl) return config.publicBaseUrl;
  const proto = isHttpsRequest(request) ? 'https' : 'http';
  const hostHeader = request.headers['x-forwarded-host'] ?? request.headers.host ?? `127.0.0.1:${config.port}`;
  const host = Array.isArray(hostHeader) ? hostHeader[0] : hostHeader.split(',')[0].trim();
  return `${proto}://${host}`;
}

function setSessionCookie(reply: FastifyReply, request: FastifyRequest, token: string, maxAgeSec: number): void {
  reply.setCookie(SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: isHttpsRequest(request),
    maxAge: maxAgeSec,
  });
}

function formatUserInfoHeader(sources: SourceRecord[]): string | null {
  let upload = 0;
  let download = 0;
  let total = 0;
  let earliestExpire: number | null = null;
  let hasTraffic = false;

  for (const source of sources) {
    if (!source.enabled || source.kind !== 'subscription') continue;
    if (source.totalBytes && source.totalBytes > 0) {
      hasTraffic = true;
      upload += source.uploadBytes ?? 0;
      download += source.downloadBytes ?? 0;
      total += source.totalBytes;
    }
    if (source.expireAt && source.expireAt > 0) {
      if (earliestExpire === null || source.expireAt < earliestExpire) {
        earliestExpire = source.expireAt;
      }
    }
  }

  const parts: string[] = [];
  if (hasTraffic) {
    parts.push(`upload=${upload}`, `download=${download}`, `total=${total}`);
  }
  if (earliestExpire !== null) {
    parts.push(`expire=${earliestExpire}`);
  }
  return parts.length ? parts.join('; ') : null;
}

function buildSubscribeUrl(baseUrl: string, client: ClientTarget, token: string): string {
  return `${baseUrl}/sub/${client}/${token}`;
}

export interface BuildAppOptions {
  config?: AppConfig;
  db?: DbClient;
}

export interface TowerAppInstance {
  app: FastifyInstance;
  db: DbClient;
  repo: TowerRepository;
  config: AppConfig;
}

export async function buildApp(options: BuildAppOptions = {}): Promise<TowerAppInstance> {
  const config = options.config ?? loadConfig();
  const db = options.db ?? (await createDbClient(config));

  // Bootstrap encryption key from env or persist generated key in DB
  let rawEncKey = config.encryptionKey;
  if (!rawEncKey) {
    const existing = await db.query<{ value: string }>(
      'SELECT value FROM app_settings WHERE key = $1',
      [ENCRYPTION_KEY_SETTING],
    );
    if (existing.rows[0]?.value) {
      rawEncKey = existing.rows[0].value;
    } else {
      rawEncKey = generateSecureToken(32);
      await db.query(
        `INSERT INTO app_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING`,
        [ENCRYPTION_KEY_SETTING, rawEncKey],
      );
      const reread = await db.query<{ value: string }>(
        'SELECT value FROM app_settings WHERE key = $1',
        [ENCRYPTION_KEY_SETTING],
      );
      rawEncKey = reread.rows[0]?.value ?? rawEncKey;
    }
  }

  const cipher = new SecretCipher(rawEncKey);
  const repo = new TowerRepository(db, cipher);
  const auth = new AuthService(config, repo);
  const loginLimiter = new MemoryRateLimiter({
    maxAttempts: 10,
    windowMs: 15 * 60 * 1000,
    lockoutMs: 15 * 60 * 1000,
  });
  const probeLimiter = new MemoryRateLimiter({
    maxAttempts: 20,
    windowMs: 60 * 1000,
  });

  const app = Fastify({
    logger: false,
    trustProxy: config.trustProxy,
    bodyLimit: 4 * 1024 * 1024,
  });

  await app.register(fastifyCookie);

  app.addHook('onSend', async (request, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'no-referrer');
    if (request.url.startsWith('/api/') || request.url.startsWith('/sub/')) {
      reply.header('Cache-Control', 'no-store');
    }
    return payload;
  });

  // Healthcheck
  app.get('/healthz', async (_request, reply) => {
    try {
      await db.ping();
      return { status: 'ok', database: 'ok', driver: db.driver };
    } catch {
      return reply.code(503).send({ status: 'error', database: 'unavailable' });
    }
  });

  // Auth endpoints (public)
  app.get('/api/auth/status', async (request): Promise<SecurityStatus> => {
    const initialized = await auth.isInitialized();
    const authenticated = await auth.verifySession(request.cookies[SESSION_COOKIE]);
    return {
      authenticated,
      initialized,
      adminPasswordExternal: auth.isExternalPassword,
      encryptionKeyExternal: Boolean(config.encryptionKey),
      allowPrivateFetch: config.allowPrivateFetch,
      databaseDriver: db.driver,
    };
  });

  app.post('/api/auth/setup', async (request, reply) => {
    const body = (request.body ?? {}) as { password?: string };
    try {
      await auth.setupInitialPassword(String(body.password ?? ''));
      const session = await auth.issueSessionToken();
      setSessionCookie(reply, request, session.token, session.maxAgeSec);
      return { ok: true };
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : '初始化失败' });
    }
  });

  app.post('/api/auth/login', async (request, reply) => {
    const key = request.ip || 'unknown';
    const gate = loginLimiter.check(key);
    if (!gate.allowed) {
      reply.header('Retry-After', String(gate.retryAfterSec));
      return reply.code(429).send({
        error: `登录尝试过于频繁，请在 ${gate.retryAfterSec} 秒后重试`,
      });
    }

    const initialized = await auth.isInitialized();
    if (!initialized) {
      return reply.code(400).send({ error: '尚未设置管理员密码，请先完成初始化' });
    }

    const body = (request.body ?? {}) as { password?: string };
    const ok = await auth.verifyAdminPassword(String(body.password ?? ''));
    if (!ok) {
      const after = loginLimiter.consume(key);
      if (!after.allowed) {
        reply.header('Retry-After', String(after.retryAfterSec));
      }
      return reply.code(401).send({ error: '管理员密码不正确' });
    }

    loginLimiter.reset(key);
    const session = await auth.issueSessionToken();
    setSessionCookie(reply, request, session.token, session.maxAgeSec);
    return { ok: true };
  });

  app.post('/api/auth/logout', async (_request, reply) => {
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  // Protected admin routes
  await app.register(async (admin) => {
    admin.addHook('preHandler', async (request, reply) => {
      const ok = await auth.verifySession(request.cookies[SESSION_COOKIE]);
      if (!ok) {
        return reply.code(401).send({ error: '未登录或会话已失效' });
      }
    });

    admin.post('/api/auth/password', async (request, reply) => {
      const body = (request.body ?? {}) as { currentPassword?: string; newPassword?: string };
      try {
        await auth.changePassword(String(body.currentPassword ?? ''), String(body.newPassword ?? ''));
        const session = await auth.issueSessionToken();
        setSessionCookie(reply, request, session.token, session.maxAgeSec);
        return { ok: true };
      } catch (err) {
        return reply.code(400).send({ error: err instanceof Error ? err.message : '修改密码失败' });
      }
    });

    admin.get('/api/overview', async () => {
      const [sources, nodes, channels] = await Promise.all([
        repo.listSources(),
        repo.listNodes({ includeDisabledSources: true }),
        repo.listChannels(),
      ]);
      const regionCounts: Record<string, number> = {};
      const protocolCounts: Record<string, number> = {};
      let activeNodes = 0;
      let blockedNodes = 0;
      for (const node of nodes) {
        if (node.blocked) {
          blockedNodes += 1;
        } else {
          activeNodes += 1;
          regionCounts[node.region] = (regionCounts[node.region] ?? 0) + 1;
        }
        protocolCounts[node.protocol] = (protocolCounts[node.protocol] ?? 0) + 1;
      }
      return {
        sourceCount: sources.length,
        enabledSourceCount: sources.filter((s) => s.enabled).length,
        totalNodes: nodes.length,
        activeNodes,
        blockedNodes,
        channelCount: channels.length,
        activeChannelCount: channels.filter((c) => c.enabled).length,
        regionCounts,
        protocolCounts,
      };
    });

    // Sources
    async function syncSubscriptionSource(source: SourceRecord) {
      if (source.kind !== 'subscription' || !source.url) {
        throw new Error('仅远程订阅源支持拉取同步');
      }
      try {
        const fetched = await safeFetchSubscription(source.url, {
          allowPrivate: config.allowPrivateFetch,
          userAgent: source.userAgent,
        });
        const parsed = parseSubscriptionPayload(fetched.body, {
          filterNotices: true,
          userInfoHeader: fetched.headers['subscription-userinfo'],
        });
        const nodes = await repo.syncSourceNodes(source.id, parsed.nodes, {
          filteredCount: parsed.filteredCount,
          userInfo: parsed.userInfo,
        });
        const updatedSource = await repo.getSource(source.id);
        return {
          source: updatedSource,
          format: parsed.format,
          nodeCount: nodes.length,
          filteredCount: parsed.filteredCount,
          skippedInvalidCount: parsed.skippedInvalidCount,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : '订阅同步失败';
        await repo.setSourceSyncError(source.id, message);
        throw err;
      }
    }

    admin.get('/api/sources', async () => {
      return { sources: await repo.listSources() };
    });

    admin.post('/api/sources', async (request, reply) => {
      const body = (request.body ?? {}) as {
        name?: string;
        kind?: 'subscription' | 'manual';
        url?: string;
        userAgent?: string;
        enabled?: boolean;
        syncNow?: boolean;
      };
      const name = String(body.name ?? '').trim();
      const kind = body.kind === 'manual' ? 'manual' : 'subscription';
      if (!name) return reply.code(400).send({ error: '请填写订阅名称' });
      if (kind === 'subscription' && !body.url?.trim()) {
        return reply.code(400).send({ error: '请填写远程订阅链接' });
      }

      const created = await repo.createSource({
        name,
        kind,
        url: kind === 'subscription' ? body.url?.trim() : null,
        userAgent: body.userAgent?.trim() || null,
        enabled: body.enabled ?? true,
      });

      if (kind === 'subscription' && body.syncNow !== false) {
        try {
          const sync = await syncSubscriptionSource(created);
          return reply.code(201).send({ source: sync.source, sync });
        } catch (err) {
          const refreshed = await repo.getSource(created.id);
          return reply.code(201).send({
            source: refreshed,
            syncError: err instanceof Error ? err.message : '首次拉取失败',
          });
        }
      }

      return reply.code(201).send({ source: created });
    });

    admin.patch('/api/sources/:id', async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = (request.body ?? {}) as {
        name?: string;
        url?: string | null;
        enabled?: boolean;
        userAgent?: string | null;
      };
      const updated = await repo.updateSource(id, {
        name: body.name !== undefined ? String(body.name).trim() : undefined,
        url: body.url !== undefined ? (body.url ? String(body.url).trim() : null) : undefined,
        enabled: body.enabled,
        userAgent:
          body.userAgent !== undefined
            ? body.userAgent
              ? String(body.userAgent).trim()
              : null
            : undefined,
      });
      if (!updated) return reply.code(404).send({ error: '订阅源不存在' });
      return { source: updated };
    });

    admin.delete('/api/sources/:id', async (request, reply) => {
      const { id } = request.params as { id: string };
      const ok = await repo.deleteSource(id);
      if (!ok) return reply.code(404).send({ error: '订阅源不存在' });
      return { ok: true };
    });

    admin.post('/api/sources/:id/sync', async (request, reply) => {
      const { id } = request.params as { id: string };
      const source = await repo.getSource(id);
      if (!source) return reply.code(404).send({ error: '订阅源不存在' });
      try {
        const result = await syncSubscriptionSource(source);
        return result;
      } catch (err) {
        const status = err instanceof SsrfBlockedError ? 400 : 502;
        return reply.code(status).send({ error: err instanceof Error ? err.message : '同步失败' });
      }
    });

    admin.post('/api/sources/sync-all', async () => {
      const sources = (await repo.listSources()).filter(
        (s) => s.kind === 'subscription' && s.enabled && s.url,
      );
      const results: Array<{ id: string; name: string; ok: boolean; nodeCount?: number; error?: string }> = [];
      for (const source of sources) {
        try {
          const synced = await syncSubscriptionSource(source);
          results.push({ id: source.id, name: source.name, ok: true, nodeCount: synced.nodeCount });
        } catch (err) {
          results.push({
            id: source.id,
            name: source.name,
            ok: false,
            error: err instanceof Error ? err.message : '同步失败',
          });
        }
      }
      return { results };
    });

    admin.post('/api/sources/manual/import', async (request, reply) => {
      const body = (request.body ?? {}) as {
        text?: string;
        sourceId?: string;
        filterNotices?: boolean;
      };
      if (!body.text?.trim()) {
        return reply.code(400).send({ error: '请粘贴节点 URI、Surge 代理行或 Clash YAML' });
      }
      try {
        const parsed = parseSubscriptionPayload(body.text, {
          filterNotices: body.filterNotices ?? false,
        });
        const targetSource = body.sourceId
          ? await repo.getSource(body.sourceId)
          : await repo.ensureManualSource();
        if (!targetSource) return reply.code(404).send({ error: '目标分组不存在' });
        const nodes = await repo.addManualNodes(targetSource.id, parsed.nodes);
        return reply.code(201).send({
          source: await repo.getSource(targetSource.id),
          importedCount: parsed.nodes.length,
          filteredCount: parsed.filteredCount,
          nodes,
        });
      } catch (err) {
        return reply.code(400).send({ error: err instanceof Error ? err.message : '导入解析失败' });
      }
    });

    admin.post('/api/sources/manual/node', async (request, reply) => {
      const body = (request.body ?? {}) as {
        name?: string;
        protocol?: ProxyNodeConfig['protocol'];
        host?: string;
        port?: number;
        password?: string;
        uuid?: string;
        method?: string;
        psk?: string;
        snellVersion?: number;
        sni?: string;
        tls?: boolean;
        skipCertVerify?: boolean;
        certFingerprintSha256?: string;
        portHopping?: string;
        shadowTlsPassword?: string;
        shadowTlsVersion?: 2 | 3;
        shadowTlsSni?: string;
        wgPrivateKey?: string;
        wgPublicKey?: string;
        wgSelfIp?: string;
      };
      try {
        const protocol = body.protocol ?? 'ss';
        const host = normalizeHost(body.host);
        const port = normalizePort(body.port);
        const cleanName = sanitizeNodeName(body.name || `${protocol}-${host}:${port}`);
        const configObj: ProxyNodeConfig = {
          protocol,
          host,
          port,
          password: optionalSafeText(body.password),
          uuid: optionalSafeText(body.uuid),
          method: optionalSafeText(body.method),
          psk: optionalSafeText(body.psk),
          snellVersion: body.snellVersion ? Number(body.snellVersion) : undefined,
          tls: body.tls,
          sni: optionalSafeText(body.sni),
          skipCertVerify: body.skipCertVerify,
          certFingerprintSha256: normalizeSha256Fingerprint(body.certFingerprintSha256),
          portHopping: optionalSafeText(body.portHopping),
          wgPrivateKey: optionalSafeText(body.wgPrivateKey),
          wgPublicKey: optionalSafeText(body.wgPublicKey),
          wgSelfIp: optionalSafeText(body.wgSelfIp),
          shadowTls: body.shadowTlsPassword?.trim()
            ? {
                version: body.shadowTlsVersion === 2 ? 2 : 3,
                password: body.shadowTlsPassword.trim(),
                sni: optionalSafeText(body.shadowTlsSni),
              }
            : undefined,
        };
        const meta = detectRegionAndMeta(cleanName, host);
        const input: ParsedNodeInput = {
          fingerprint: computeNodeFingerprint(configObj),
          originalName: cleanName,
          protocol,
          host,
          port,
          config: configObj,
          detectedRegion: meta.region,
          multiplier: meta.multiplier,
          tags: meta.tags,
        };
        const manualSource = await repo.ensureManualSource();
        await repo.addManualNodes(manualSource.id, [input]);
        return reply.code(201).send({ ok: true, sourceId: manualSource.id });
      } catch (err) {
        return reply.code(400).send({ error: err instanceof Error ? err.message : '节点参数无效' });
      }
    });

    // Nodes
    admin.get('/api/nodes', async (request) => {
      const query = request.query as {
        sourceId?: string;
        region?: string;
        protocol?: string;
        includeDisabledSources?: string;
        excludeBlocked?: string;
      };
      const nodes = await repo.listNodes({
        sourceId: query.sourceId || undefined,
        region: query.region || undefined,
        protocol: query.protocol || undefined,
        includeDisabledSources: query.includeDisabledSources !== 'false',
        excludeBlocked: query.excludeBlocked === 'true',
      });
      return { nodes };
    });

    admin.patch('/api/nodes/:id', async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = (request.body ?? {}) as {
        blocked?: boolean;
        customName?: string | null;
        regionOverride?: string | null;
      };
      const updated = await repo.updateNode(id, {
        blocked: body.blocked,
        customName:
          body.customName !== undefined
            ? body.customName
              ? sanitizeNodeName(body.customName)
              : null
            : undefined,
        regionOverride:
          body.regionOverride !== undefined
            ? body.regionOverride
              ? String(body.regionOverride).trim().toUpperCase()
              : null
            : undefined,
      });
      if (!updated) return reply.code(404).send({ error: '节点不存在' });
      return { node: updated };
    });

    admin.post('/api/nodes/bulk', async (request, reply) => {
      const body = (request.body ?? {}) as {
        ids?: string[];
        action?: 'block' | 'unblock' | 'delete' | 'setRegion';
        regionOverride?: string | null;
      };
      if (!Array.isArray(body.ids) || body.ids.length === 0) {
        return reply.code(400).send({ error: '请选择至少一个节点' });
      }
      let affected = 0;
      for (const id of body.ids) {
        if (body.action === 'block') {
          if (await repo.updateNode(id, { blocked: true })) affected += 1;
        } else if (body.action === 'unblock') {
          if (await repo.updateNode(id, { blocked: false })) affected += 1;
        } else if (body.action === 'delete') {
          if (await repo.deleteNode(id)) affected += 1;
        } else if (body.action === 'setRegion') {
          const region = body.regionOverride ? body.regionOverride.trim().toUpperCase() : null;
          if (await repo.updateNode(id, { regionOverride: region })) affected += 1;
        }
      }
      return { ok: true, affected };
    });

    admin.delete('/api/nodes/:id', async (request, reply) => {
      const { id } = request.params as { id: string };
      const ok = await repo.deleteNode(id);
      if (!ok) return reply.code(404).send({ error: '节点不存在' });
      return { ok: true };
    });

    admin.post('/api/nodes/probe', async (request, reply) => {
      const gate = probeLimiter.consume(request.ip || 'probe');
      if (!gate.allowed) {
        return reply.code(429).send({ error: '测速过于频繁，请稍后再试' });
      }
      const body = (request.body ?? {}) as { nodeIds?: string[]; region?: string };
      let targets = await repo.listNodes({
        region: body.region || undefined,
        excludeBlocked: false,
      });
      if (Array.isArray(body.nodeIds) && body.nodeIds.length > 0) {
        const set = new Set(body.nodeIds);
        targets = targets.filter((n) => set.has(n.id));
      }
      targets = targets.slice(0, 60);
      const results = await probeNodesBatch(targets, {
        allowPrivate: config.allowPrivateFetch,
        timeoutMs: 3500,
        concurrency: 8,
      });
      for (const item of results) {
        await repo.recordNodeLatency(item.nodeId, item.latencyMs, item.error);
      }
      return {
        testedCount: results.length,
        results,
        note: '延迟数据为部署服务端节点到目标代理端口的 TCP 握手耗时',
      };
    });

    // Routing profile
    admin.get('/api/routing', async () => {
      return { profile: await repo.getRoutingProfile() };
    });

    admin.put('/api/routing', async (request, reply) => {
      const body = (request.body ?? {}) as { profile?: RoutingProfile };
      if (!body.profile || !Array.isArray(body.profile.groups) || !Array.isArray(body.profile.rules)) {
        return reply.code(400).send({ error: '规则方案格式无效' });
      }
      const saved = await repo.saveRoutingProfile(body.profile);
      return { profile: saved };
    });

    admin.post('/api/routing/preset', async (request) => {
      const body = (request.body ?? {}) as { preset?: RoutingProfile['preset'] };
      const preset =
        body.preset === 'low-multiplier' || body.preset === 'residential-isolated'
          ? body.preset
          : 'standard';
      const current = await repo.getRoutingProfile();
      const next = createDefaultRoutingProfile(preset);
      next.tailscale = current.tailscale;
      const saved = await repo.saveRoutingProfile(next);
      return { profile: saved };
    });

    // Export channels & preview
    admin.get('/api/channels', async (request) => {
      const baseUrl = resolvePublicBaseUrl(request, config);
      const channels = await repo.listChannels();
      return {
        baseUrl,
        channels: channels.map((ch) => ({
          ...ch,
          subscribeUrl: buildSubscribeUrl(baseUrl, ch.client, ch.token),
        })),
      };
    });

    admin.post('/api/channels', async (request, reply) => {
      const body = (request.body ?? {}) as {
        name?: string;
        client?: ClientTarget;
        mode?: ExportMode;
        enabled?: boolean;
        sourceIds?: string[];
        includeRegions?: string[];
        excludeBlocked?: boolean;
        customFilename?: string | null;
      };
      const name = String(body.name ?? '').trim();
      const client = body.client;
      if (!name) return reply.code(400).send({ error: '请填写托管通道名称' });
      if (!client || !VALID_CLIENTS.has(client)) {
        return reply.code(400).send({ error: '不支持的目标客户端类型' });
      }
      const meta = CLIENT_MAP[client];
      const mode: ExportMode =
        body.mode && meta.supportsModes.includes(body.mode) ? body.mode : meta.defaultMode;
      try {
        const created = await repo.createChannel({
          name,
          client,
          mode,
          enabled: body.enabled ?? true,
          sourceIds: Array.isArray(body.sourceIds) ? body.sourceIds : [],
          includeRegions: Array.isArray(body.includeRegions) ? body.includeRegions : [],
          excludeBlocked: body.excludeBlocked ?? true,
          customFilename: body.customFilename?.trim() || null,
        });
        const baseUrl = resolvePublicBaseUrl(request, config);
        return reply.code(201).send({
          channel: { ...created, subscribeUrl: buildSubscribeUrl(baseUrl, created.client, created.token) },
        });
      } catch (err) {
        return reply.code(400).send({ error: err instanceof Error ? err.message : '创建失败' });
      }
    });

    admin.patch('/api/channels/:id', async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = (request.body ?? {}) as {
        name?: string;
        client?: ClientTarget;
        mode?: ExportMode;
        enabled?: boolean;
        sourceIds?: string[];
        includeRegions?: string[];
        excludeBlocked?: boolean;
        customFilename?: string | null;
      };
      if (body.client && !VALID_CLIENTS.has(body.client)) {
        return reply.code(400).send({ error: '不支持的目标客户端类型' });
      }
      try {
        const updated = await repo.updateChannel(id, {
          name: body.name !== undefined ? String(body.name).trim() : undefined,
          client: body.client,
          mode: body.mode,
          enabled: body.enabled,
          sourceIds: body.sourceIds,
          includeRegions: body.includeRegions,
          excludeBlocked: body.excludeBlocked,
          customFilename:
            body.customFilename !== undefined
              ? body.customFilename
                ? String(body.customFilename).trim()
                : null
              : undefined,
        });
        if (!updated) return reply.code(404).send({ error: '托管通道不存在' });
        const baseUrl = resolvePublicBaseUrl(request, config);
        return {
          channel: { ...updated, subscribeUrl: buildSubscribeUrl(baseUrl, updated.client, updated.token) },
        };
      } catch (err) {
        return reply.code(400).send({ error: err instanceof Error ? err.message : '更新失败' });
      }
    });

    admin.post('/api/channels/:id/rotate', async (request, reply) => {
      const { id } = request.params as { id: string };
      const updated = await repo.rotateChannelToken(id);
      if (!updated) return reply.code(404).send({ error: '托管通道不存在' });
      const baseUrl = resolvePublicBaseUrl(request, config);
      return {
        channel: { ...updated, subscribeUrl: buildSubscribeUrl(baseUrl, updated.client, updated.token) },
      };
    });

    admin.delete('/api/channels/:id', async (request, reply) => {
      const { id } = request.params as { id: string };
      const ok = await repo.deleteChannel(id);
      if (!ok) return reply.code(404).send({ error: '托管通道不存在' });
      return { ok: true };
    });

    admin.post('/api/export/preview', async (request, reply) => {
      const body = (request.body ?? {}) as {
        client?: ClientTarget;
        mode?: ExportMode;
        masked?: boolean;
        channelId?: string;
        sourceIds?: string[];
        includeRegions?: string[];
        excludeBlocked?: boolean;
      };
      let client: ClientTarget = body.client ?? 'surge';
      let mode: ExportMode = body.mode ?? CLIENT_MAP[client]?.defaultMode ?? 'full';
      let sourceIds = body.sourceIds ?? [];
      let includeRegions = body.includeRegions ?? [];
      let excludeBlocked = body.excludeBlocked ?? true;
      let managedUrl: string | undefined;
      let filename: string | undefined;

      if (body.channelId) {
        const channel = await repo.getChannel(body.channelId);
        if (!channel) return reply.code(404).send({ error: '托管通道不存在' });
        client = body.client ?? channel.client;
        mode = body.mode ?? channel.mode;
        sourceIds = body.sourceIds ?? channel.sourceIds;
        includeRegions = body.includeRegions ?? channel.includeRegions;
        excludeBlocked = body.excludeBlocked ?? channel.excludeBlocked;
        managedUrl = buildSubscribeUrl(resolvePublicBaseUrl(request, config), channel.client, channel.token);
        filename = channel.customFilename ?? undefined;
      }

      if (!VALID_CLIENTS.has(client)) {
        return reply.code(400).send({ error: '不支持的目标客户端类型' });
      }

      const [allNodes, profile] = await Promise.all([
        repo.listNodes({ excludeBlocked }),
        repo.getRoutingProfile(),
      ]);

      const filteredNodes = allNodes.filter((node) => {
        if (sourceIds.length > 0 && !sourceIds.includes(node.sourceId)) return false;
        if (includeRegions.length > 0 && !includeRegions.includes(node.region)) return false;
        return true;
      });

      const preview = generateExport({
        client,
        mode,
        nodes: filteredNodes,
        profile,
        masked: body.masked ?? true,
        forPreview: true,
        managedUrl,
        filename,
      });
      return preview;
    });

    admin.post('/api/export/qrcode', async (request, reply) => {
      const body = (request.body ?? {}) as { text?: string };
      const text = String(body.text ?? '').trim();
      if (!text || text.length > 2048) {
        return reply.code(400).send({ error: '二维码内容无效' });
      }
      const dataUrl = await QRCode.toDataURL(text, {
        margin: 1,
        width: 240,
        color: { dark: '#0A0A0A', light: '#FFFFFF' },
      });
      return { dataUrl };
    });
  });

  // Public hosted subscription endpoint (token-only, zero admin exposure)
  app.get('/sub/:client/:token', async (request, reply) => {
    const { client, token } = request.params as { client: string; token: string };
    const query = request.query as { raw?: string };
    const channel = await repo.findChannelByToken(token);
    if (!channel || !channel.enabled || channel.client !== client) {
      return reply.code(404).type('text/plain; charset=utf-8').send('Subscription channel not found');
    }

    const [allNodes, profile, sources] = await Promise.all([
      repo.listNodes({ excludeBlocked: channel.excludeBlocked }),
      repo.getRoutingProfile(),
      repo.listSources(),
    ]);

    const filteredNodes = allNodes.filter((node) => {
      if (channel.sourceIds.length > 0 && !channel.sourceIds.includes(node.sourceId)) return false;
      if (channel.includeRegions.length > 0 && !channel.includeRegions.includes(node.region)) {
        return false;
      }
      return true;
    });

    const includedSources =
      channel.sourceIds.length > 0
        ? sources.filter((s) => channel.sourceIds.includes(s.id))
        : sources;
    const userInfoHeader = formatUserInfoHeader(includedSources);
    const managedUrl = buildSubscribeUrl(resolvePublicBaseUrl(request, config), channel.client, channel.token);

    const exported = generateExport({
      client: channel.client,
      mode: channel.mode,
      nodes: filteredNodes,
      profile,
      masked: false,
      forPreview: query.raw === '1',
      managedUrl,
      filename: channel.customFilename ?? undefined,
    });

    await repo.recordChannelAccess(channel.id);

    reply.header('Content-Type', exported.contentType);
    reply.header(
      'Content-Disposition',
      `inline; filename="${exported.filename.replace(/[^A-Za-z0-9._-]/g, '_')}"`,
    );
    reply.header('Profile-Update-Interval', '24');
    if (userInfoHeader) {
      reply.header('Subscription-Userinfo', userInfoHeader);
    }
    return reply.send(exported.content);
  });

  // Serve built frontend static assets in production
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const webDistCandidates = [
    path.resolve(process.cwd(), 'dist/web'),
    path.resolve(currentDir, '../../web'),
    path.resolve(currentDir, '../../../dist/web'),
  ];
  const webDistDir = webDistCandidates.find((dir) => fs.existsSync(path.join(dir, 'index.html')));

  if (webDistDir) {
    await app.register(fastifyStatic, {
      root: webDistDir,
      prefix: '/',
      wildcard: false,
    });

    app.setNotFoundHandler(async (request, reply) => {
      if (request.url.startsWith('/api/') || request.url.startsWith('/sub/')) {
        return reply.code(404).send({ error: 'Not Found' });
      }
      return reply.sendFile('index.html');
    });
  }

  app.addHook('onClose', async () => {
    await db.close();
  });

  return { app, db, repo, config };
}
