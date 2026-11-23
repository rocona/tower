import crypto from 'node:crypto';
import type {
  ClientTarget,
  ExportChannelRecord,
  ExportMode,
  NodeRecord,
  ProxyNodeConfig,
  RoutingProfile,
  SourceRecord,
  SubscriptionUserInfo,
} from '../../shared/types.js';
import type { DbClient } from './client.js';
import { createDefaultRoutingProfile } from './defaults.js';
import { SecretCipher, generateSecureToken, sha256Hex } from '../security/crypto.js';
import { detectRegionAndMeta } from '../services/regionDetector.js';

export interface ParsedNodeInput {
  fingerprint: string;
  originalName: string;
  protocol: ProxyNodeConfig['protocol'];
  host: string;
  port: number;
  config: ProxyNodeConfig;
  detectedRegion: string;
  multiplier: number | null;
  tags: string[];
}

interface SourceRow {
  id: string;
  name: string;
  kind: 'subscription' | 'manual';
  url_enc: string | null;
  enabled: boolean;
  user_agent: string | null;
  last_synced_at: string | Date | null;
  last_error: string | null;
  node_count: number;
  filtered_count: number;
  upload_bytes: string | number | null;
  download_bytes: string | number | null;
  total_bytes: string | number | null;
  expire_at: string | number | null;
  created_at: string | Date;
  updated_at: string | Date;
}

interface NodeRow {
  id: string;
  source_id: string;
  source_name?: string;
  fingerprint: string;
  original_name: string;
  custom_name: string | null;
  protocol: ProxyNodeConfig['protocol'];
  host: string;
  port: number;
  config_enc: string;
  detected_region: string;
  region_override: string | null;
  multiplier: number | null;
  tags: string[] | string;
  blocked: boolean;
  latency_ms: number | null;
  latency_tested_at: string | Date | null;
  latency_error: string | null;
  created_at: string | Date;
  updated_at: string | Date;
}

interface ChannelRow {
  id: string;
  name: string;
  client: ClientTarget;
  mode: ExportMode;
  token_hash: string;
  token_enc: string;
  enabled: boolean;
  source_ids: string[] | string;
  include_regions: string[] | string;
  exclude_blocked: boolean;
  custom_filename: string | null;
  access_count: number;
  last_accessed_at: string | Date | null;
  created_at: string | Date;
  updated_at: string | Date;
}

function toIso(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString();
}

function toNum(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function parseJsonArray<T>(value: T[] | string | null | undefined): T[] {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? (parsed as T[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}

export class TowerRepository {
  constructor(
    readonly db: DbClient,
    private readonly cipher: SecretCipher,
  ) {}

  async getSetting(key: string): Promise<string | null> {
    const res = await this.db.query<{ value: string }>(
      'SELECT value FROM app_settings WHERE key = $1',
      [key],
    );
    return res.rows[0]?.value ?? null;
  }

  async setSetting(key: string, value: string): Promise<void> {
    await this.db.query(
      `INSERT INTO app_settings (key, value, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [key, value],
    );
  }

  async getOrCreateSetting(key: string, factory: () => string): Promise<string> {
    const existing = await this.getSetting(key);
    if (existing !== null) return existing;
    const created = factory();
    await this.db.query(
      `INSERT INTO app_settings (key, value, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO NOTHING`,
      [key, created],
    );
    return (await this.getSetting(key)) ?? created;
  }

  private mapSource(row: SourceRow): SourceRecord {
    return {
      id: row.id,
      name: row.name,
      kind: row.kind,
      url: this.cipher.decryptNullable(row.url_enc),
      enabled: Boolean(row.enabled),
      userAgent: row.user_agent,
      lastSyncedAt: toIso(row.last_synced_at),
      lastError: row.last_error,
      nodeCount: Number(row.node_count ?? 0),
      filteredCount: Number(row.filtered_count ?? 0),
      uploadBytes: toNum(row.upload_bytes),
      downloadBytes: toNum(row.download_bytes),
      totalBytes: toNum(row.total_bytes),
      expireAt: toNum(row.expire_at),
      createdAt: toIso(row.created_at) ?? new Date().toISOString(),
      updatedAt: toIso(row.updated_at) ?? new Date().toISOString(),
    };
  }

  private mapNode(row: NodeRow): NodeRecord {
    const config = JSON.parse(this.cipher.decrypt(row.config_enc)) as ProxyNodeConfig;
    const region = row.region_override || row.detected_region || 'OTHER';
    return {
      id: row.id,
      sourceId: row.source_id,
      sourceName: row.source_name,
      fingerprint: row.fingerprint,
      originalName: row.original_name,
      customName: row.custom_name,
      protocol: row.protocol,
      host: row.host,
      port: Number(row.port),
      config,
      detectedRegion: row.detected_region || 'OTHER',
      regionOverride: row.region_override,
      region,
      multiplier: row.multiplier === null || row.multiplier === undefined ? null : Number(row.multiplier),
      tags: parseJsonArray<string>(row.tags),
      blocked: Boolean(row.blocked),
      latencyMs: row.latency_ms === null || row.latency_ms === undefined ? null : Number(row.latency_ms),
      latencyTestedAt: toIso(row.latency_tested_at),
      latencyError: row.latency_error,
      createdAt: toIso(row.created_at) ?? new Date().toISOString(),
      updatedAt: toIso(row.updated_at) ?? new Date().toISOString(),
    };
  }

  async listSources(): Promise<SourceRecord[]> {
    const res = await this.db.query<SourceRow>(
      'SELECT * FROM sources ORDER BY kind ASC, created_at ASC',
    );
    return res.rows.map((row) => this.mapSource(row));
  }

  async backfillNodeMetadata(): Promise<number> {
    const res = await this.db.query<{
      id: string;
      original_name: string;
      host: string;
      detected_region: string;
      multiplier: number | null;
      tags: string[] | string;
    }>('SELECT id, original_name, host, detected_region, multiplier, tags FROM nodes');

    let updated = 0;
    for (const row of res.rows) {
      const meta = detectRegionAndMeta(row.original_name, row.host);
      const previousTags = parseJsonArray<string>(row.tags);
      const multiplierChanged =
        (row.multiplier === null || row.multiplier === undefined
          ? null
          : Number(row.multiplier)) !== meta.multiplier;
      const tagsChanged = JSON.stringify(previousTags) !== JSON.stringify(meta.tags);
      if (row.detected_region === meta.region && !multiplierChanged && !tagsChanged) {
        continue;
      }
      await this.db.query(
        `UPDATE nodes
         SET detected_region = $2, multiplier = $3, tags = $4::jsonb, updated_at = NOW()
         WHERE id = $1`,
        [row.id, meta.region, meta.multiplier, JSON.stringify(meta.tags)],
      );
      updated += 1;
    }
    return updated;
  }

  async getSource(id: string): Promise<SourceRecord | null> {
    const res = await this.db.query<SourceRow>('SELECT * FROM sources WHERE id = $1', [id]);
    return res.rows[0] ? this.mapSource(res.rows[0]) : null;
  }

  async createSource(input: {
    name: string;
    kind: 'subscription' | 'manual';
    url?: string | null;
    enabled?: boolean;
    userAgent?: string | null;
  }): Promise<SourceRecord> {
    const id = crypto.randomUUID();
    const urlEnc = this.cipher.encryptNullable(input.url ?? null);
    const res = await this.db.query<SourceRow>(
      `INSERT INTO sources (id, name, kind, url_enc, enabled, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [id, input.name, input.kind, urlEnc, input.enabled ?? true, input.userAgent ?? null],
    );
    return this.mapSource(res.rows[0]);
  }

  async ensureManualSource(): Promise<SourceRecord> {
    const existing = await this.db.query<SourceRow>(
      `SELECT * FROM sources WHERE kind = 'manual' ORDER BY created_at ASC LIMIT 1`,
    );
    if (existing.rows[0]) return this.mapSource(existing.rows[0]);
    return this.createSource({ name: '自有节点', kind: 'manual', enabled: true });
  }

  async updateSource(
    id: string,
    patch: { name?: string; url?: string | null; enabled?: boolean; userAgent?: string | null },
  ): Promise<SourceRecord | null> {
    const current = await this.getSource(id);
    if (!current) return null;
    const nextName = patch.name !== undefined ? patch.name : current.name;
    const nextUrl = patch.url !== undefined ? patch.url : current.url;
    const nextEnabled = patch.enabled !== undefined ? patch.enabled : current.enabled;
    const nextUa = patch.userAgent !== undefined ? patch.userAgent : current.userAgent;
    const res = await this.db.query<SourceRow>(
      `UPDATE sources
       SET name = $2, url_enc = $3, enabled = $4, user_agent = $5, updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [id, nextName, this.cipher.encryptNullable(nextUrl), nextEnabled, nextUa],
    );
    return res.rows[0] ? this.mapSource(res.rows[0]) : null;
  }

  async setSourceSyncError(id: string, errorMessage: string): Promise<void> {
    await this.db.query(
      `UPDATE sources SET last_error = $2, updated_at = NOW() WHERE id = $1`,
      [id, errorMessage.slice(0, 500)],
    );
  }

  async deleteSource(id: string): Promise<boolean> {
    const res = await this.db.query('DELETE FROM sources WHERE id = $1', [id]);
    return res.rowCount > 0;
  }

  async syncSourceNodes(
    sourceId: string,
    parsedNodes: ParsedNodeInput[],
    meta: { filteredCount: number; userInfo?: SubscriptionUserInfo },
  ): Promise<NodeRecord[]> {
    const deduped = new Map<string, ParsedNodeInput>();
    for (const item of parsedNodes) {
      if (!deduped.has(item.fingerprint)) {
        deduped.set(item.fingerprint, item);
      }
    }
    const uniqueNodes = [...deduped.values()];

    return this.db.transaction(async (tx) => {
      const existingRes = await tx.query<NodeRow>(
        'SELECT * FROM nodes WHERE source_id = $1',
        [sourceId],
      );
      const existingByFp = new Map<string, NodeRow>(
        existingRes.rows.map((row) => [row.fingerprint, row]),
      );

      await tx.query('DELETE FROM nodes WHERE source_id = $1', [sourceId]);

      for (const item of uniqueNodes) {
        const prev = existingByFp.get(item.fingerprint);
        const id = prev?.id ?? crypto.randomUUID();
        await tx.query(
          `INSERT INTO nodes (
            id, source_id, fingerprint, original_name, custom_name, protocol, host, port,
            config_enc, detected_region, region_override, multiplier, tags, blocked,
            latency_ms, latency_tested_at, latency_error
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8,
            $9, $10, $11, $12, $13::jsonb, $14,
            $15, $16, $17
          )`,
          [
            id,
            sourceId,
            item.fingerprint,
            item.originalName,
            prev?.custom_name ?? null,
            item.protocol,
            item.host,
            item.port,
            this.cipher.encrypt(JSON.stringify(item.config)),
            item.detectedRegion,
            prev?.region_override ?? null,
            item.multiplier,
            JSON.stringify(item.tags),
            prev ? Boolean(prev.blocked) : false,
            prev?.latency_ms ?? null,
            prev?.latency_tested_at ?? null,
            prev?.latency_error ?? null,
          ],
        );
      }

      await tx.query(
        `UPDATE sources
         SET last_synced_at = NOW(),
             last_error = NULL,
             node_count = $2,
             filtered_count = $3,
             upload_bytes = COALESCE($4, upload_bytes),
             download_bytes = COALESCE($5, download_bytes),
             total_bytes = COALESCE($6, total_bytes),
             expire_at = COALESCE($7, expire_at),
             updated_at = NOW()
         WHERE id = $1`,
        [
          sourceId,
          uniqueNodes.length,
          meta.filteredCount,
          meta.userInfo?.upload ?? null,
          meta.userInfo?.download ?? null,
          meta.userInfo?.total ?? null,
          meta.userInfo?.expire ?? null,
        ],
      );

      const saved = await tx.query<NodeRow>(
        `SELECT n.*, s.name AS source_name
         FROM nodes n
         JOIN sources s ON s.id = n.source_id
         WHERE n.source_id = $1
         ORDER BY n.original_name ASC`,
        [sourceId],
      );
      return saved.rows.map((row) => this.mapNode(row));
    });
  }

  async addManualNodes(sourceId: string, parsedNodes: ParsedNodeInput[]): Promise<NodeRecord[]> {
    return this.db.transaction(async (tx) => {
      for (const item of parsedNodes) {
        const id = crypto.randomUUID();
        await tx.query(
          `INSERT INTO nodes (
            id, source_id, fingerprint, original_name, protocol, host, port,
            config_enc, detected_region, multiplier, tags, blocked
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, FALSE
          )
          ON CONFLICT (source_id, fingerprint) DO UPDATE SET
            original_name = EXCLUDED.original_name,
            protocol = EXCLUDED.protocol,
            host = EXCLUDED.host,
            port = EXCLUDED.port,
            config_enc = EXCLUDED.config_enc,
            detected_region = EXCLUDED.detected_region,
            multiplier = EXCLUDED.multiplier,
            tags = EXCLUDED.tags,
            updated_at = NOW()`,
          [
            id,
            sourceId,
            item.fingerprint,
            item.originalName,
            item.protocol,
            item.host,
            item.port,
            this.cipher.encrypt(JSON.stringify(item.config)),
            item.detectedRegion,
            item.multiplier,
            JSON.stringify(item.tags),
          ],
        );
      }
      const countRes = await tx.query<{ count: string }>(
        'SELECT COUNT(*)::text AS count FROM nodes WHERE source_id = $1',
        [sourceId],
      );
      await tx.query(
        `UPDATE sources SET node_count = $2, last_synced_at = NOW(), updated_at = NOW() WHERE id = $1`,
        [sourceId, Number(countRes.rows[0]?.count ?? 0)],
      );
      const saved = await tx.query<NodeRow>(
        `SELECT n.*, s.name AS source_name
         FROM nodes n JOIN sources s ON s.id = n.source_id
         WHERE n.source_id = $1 ORDER BY n.created_at DESC`,
        [sourceId],
      );
      return saved.rows.map((row) => this.mapNode(row));
    });
  }

  async listNodes(filters?: {
    sourceId?: string;
    region?: string;
    protocol?: string;
    includeDisabledSources?: boolean;
    excludeBlocked?: boolean;
  }): Promise<NodeRecord[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (!filters?.includeDisabledSources) {
      conditions.push('s.enabled = TRUE');
    }
    if (filters?.sourceId) {
      params.push(filters.sourceId);
      conditions.push(`n.source_id = $${params.length}`);
    }
    if (filters?.region) {
      params.push(filters.region);
      conditions.push(`COALESCE(n.region_override, n.detected_region) = $${params.length}`);
    }
    if (filters?.protocol) {
      params.push(filters.protocol);
      conditions.push(`n.protocol = $${params.length}`);
    }
    if (filters?.excludeBlocked) {
      conditions.push('n.blocked = FALSE');
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const res = await this.db.query<NodeRow>(
      `SELECT n.*, s.name AS source_name
       FROM nodes n
       JOIN sources s ON s.id = n.source_id
       ${where}
       ORDER BY n.blocked ASC, COALESCE(n.region_override, n.detected_region) ASC, n.original_name ASC`,
      params,
    );
    return res.rows.map((row) => this.mapNode(row));
  }

  async getNode(id: string): Promise<NodeRecord | null> {
    const res = await this.db.query<NodeRow>(
      `SELECT n.*, s.name AS source_name
       FROM nodes n JOIN sources s ON s.id = n.source_id
       WHERE n.id = $1`,
      [id],
    );
    return res.rows[0] ? this.mapNode(res.rows[0]) : null;
  }

  async updateNode(
    id: string,
    patch: { blocked?: boolean; customName?: string | null; regionOverride?: string | null },
  ): Promise<NodeRecord | null> {
    const current = await this.getNode(id);
    if (!current) return null;
    const nextBlocked = patch.blocked !== undefined ? patch.blocked : current.blocked;
    const nextCustomName = patch.customName !== undefined ? patch.customName : current.customName;
    const nextRegion = patch.regionOverride !== undefined ? patch.regionOverride : current.regionOverride;
    await this.db.query(
      `UPDATE nodes
       SET blocked = $2, custom_name = $3, region_override = $4, updated_at = NOW()
       WHERE id = $1`,
      [id, nextBlocked, nextCustomName, nextRegion],
    );
    return this.getNode(id);
  }

  async deleteNode(id: string): Promise<boolean> {
    const existing = await this.getNode(id);
    if (!existing) return false;
    await this.db.query('DELETE FROM nodes WHERE id = $1', [id]);
    await this.db.query(
      `UPDATE sources
       SET node_count = (SELECT COUNT(*) FROM nodes WHERE source_id = $1), updated_at = NOW()
       WHERE id = $1`,
      [existing.sourceId],
    );
    return true;
  }

  async recordNodeLatency(
    id: string,
    latencyMs: number | null,
    error: string | null,
  ): Promise<void> {
    await this.db.query(
      `UPDATE nodes
       SET latency_ms = $2, latency_tested_at = NOW(), latency_error = $3, updated_at = NOW()
       WHERE id = $1`,
      [id, latencyMs, error ? error.slice(0, 200) : null],
    );
  }

  async getRoutingProfile(): Promise<RoutingProfile> {
    const res = await this.db.query<{ payload: RoutingProfile | string; updated_at: string | Date }>(
      'SELECT payload, updated_at FROM routing_profiles WHERE id = $1',
      ['default'],
    );
    if (!res.rows[0]) {
      const profile = createDefaultRoutingProfile('standard');
      await this.saveRoutingProfile(profile);
      return profile;
    }
    const raw = res.rows[0].payload;
    const parsed = (typeof raw === 'string' ? JSON.parse(raw) : raw) as RoutingProfile;
    return {
      ...parsed,
      updatedAt: toIso(res.rows[0].updated_at) ?? parsed.updatedAt,
    };
  }

  async saveRoutingProfile(profile: RoutingProfile): Promise<RoutingProfile> {
    const normalized: RoutingProfile = {
      ...profile,
      id: 'default',
      updatedAt: new Date().toISOString(),
    };
    await this.db.query(
      `INSERT INTO routing_profiles (id, name, preset, payload, updated_at)
       VALUES ('default', $1, $2, $3::jsonb, NOW())
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         preset = EXCLUDED.preset,
         payload = EXCLUDED.payload,
         updated_at = NOW()`,
      [normalized.name, normalized.preset, JSON.stringify(normalized)],
    );
    return normalized;
  }

  private mapChannel(row: ChannelRow): ExportChannelRecord {
    return {
      id: row.id,
      name: row.name,
      client: row.client,
      mode: row.mode,
      token: this.cipher.decrypt(row.token_enc),
      enabled: Boolean(row.enabled),
      sourceIds: parseJsonArray<string>(row.source_ids),
      includeRegions: parseJsonArray<string>(row.include_regions),
      excludeBlocked: Boolean(row.exclude_blocked),
      customFilename: row.custom_filename,
      accessCount: Number(row.access_count ?? 0),
      lastAccessedAt: toIso(row.last_accessed_at),
      createdAt: toIso(row.created_at) ?? new Date().toISOString(),
      updatedAt: toIso(row.updated_at) ?? new Date().toISOString(),
    };
  }

  async listChannels(): Promise<ExportChannelRecord[]> {
    const res = await this.db.query<ChannelRow>(
      'SELECT * FROM export_channels ORDER BY created_at DESC',
    );
    return res.rows.map((row) => this.mapChannel(row));
  }

  async getChannel(id: string): Promise<ExportChannelRecord | null> {
    const res = await this.db.query<ChannelRow>(
      'SELECT * FROM export_channels WHERE id = $1',
      [id],
    );
    return res.rows[0] ? this.mapChannel(res.rows[0]) : null;
  }

  async findChannelByToken(token: string): Promise<ExportChannelRecord | null> {
    const tokenHash = sha256Hex(token);
    const res = await this.db.query<ChannelRow>(
      'SELECT * FROM export_channels WHERE token_hash = $1',
      [tokenHash],
    );
    if (!res.rows[0]) return null;
    const channel = this.mapChannel(res.rows[0]);
    return channel.token === token ? channel : null;
  }

  async createChannel(input: {
    name: string;
    client: ClientTarget;
    mode: ExportMode;
    enabled?: boolean;
    sourceIds?: string[];
    includeRegions?: string[];
    excludeBlocked?: boolean;
    customFilename?: string | null;
  }): Promise<ExportChannelRecord> {
    const id = crypto.randomUUID();
    const token = generateSecureToken(32);
    const res = await this.db.query<ChannelRow>(
      `INSERT INTO export_channels (
        id, name, client, mode, token_hash, token_enc, enabled,
        source_ids, include_regions, exclude_blocked, custom_filename
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7,
        $8::jsonb, $9::jsonb, $10, $11
      ) RETURNING *`,
      [
        id,
        input.name,
        input.client,
        input.mode,
        sha256Hex(token),
        this.cipher.encrypt(token),
        input.enabled ?? true,
        JSON.stringify(input.sourceIds ?? []),
        JSON.stringify(input.includeRegions ?? []),
        input.excludeBlocked ?? true,
        input.customFilename ?? null,
      ],
    );
    return this.mapChannel(res.rows[0]);
  }

  async updateChannel(
    id: string,
    patch: {
      name?: string;
      client?: ClientTarget;
      mode?: ExportMode;
      enabled?: boolean;
      sourceIds?: string[];
      includeRegions?: string[];
      excludeBlocked?: boolean;
      customFilename?: string | null;
    },
  ): Promise<ExportChannelRecord | null> {
    const current = await this.getChannel(id);
    if (!current) return null;
    const res = await this.db.query<ChannelRow>(
      `UPDATE export_channels
       SET name = $2,
           client = $3,
           mode = $4,
           enabled = $5,
           source_ids = $6::jsonb,
           include_regions = $7::jsonb,
           exclude_blocked = $8,
           custom_filename = $9,
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [
        id,
        patch.name ?? current.name,
        patch.client ?? current.client,
        patch.mode ?? current.mode,
        patch.enabled ?? current.enabled,
        JSON.stringify(patch.sourceIds ?? current.sourceIds),
        JSON.stringify(patch.includeRegions ?? current.includeRegions),
        patch.excludeBlocked ?? current.excludeBlocked,
        patch.customFilename !== undefined ? patch.customFilename : current.customFilename,
      ],
    );
    return res.rows[0] ? this.mapChannel(res.rows[0]) : null;
  }

  async rotateChannelToken(id: string): Promise<ExportChannelRecord | null> {
    const token = generateSecureToken(32);
    const res = await this.db.query<ChannelRow>(
      `UPDATE export_channels
       SET token_hash = $2, token_enc = $3, updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [id, sha256Hex(token), this.cipher.encrypt(token)],
    );
    return res.rows[0] ? this.mapChannel(res.rows[0]) : null;
  }

  async recordChannelAccess(id: string): Promise<void> {
    await this.db.query(
      `UPDATE export_channels
       SET access_count = access_count + 1, last_accessed_at = NOW()
       WHERE id = $1`,
      [id],
    );
  }

  async deleteChannel(id: string): Promise<boolean> {
    const res = await this.db.query('DELETE FROM export_channels WHERE id = $1', [id]);
    return res.rowCount > 0;
  }
}
