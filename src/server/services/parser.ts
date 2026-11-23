import { parse as parseYaml } from 'yaml';
import type {
  ShadowTlsOptions,
  SubscriptionUserInfo,
  TransportOptions,
  TransportType,
} from '../../shared/types.js';
import type { ParsedNodeInput } from '../db/repository.js';
import { parseSingleShareUri, type RawParsedNode } from './parseUri.js';
import {
  computeNodeFingerprint,
  decodeBase64Safe,
  extractUserInfoFromNoticeNames,
  isInformationalNodeName,
  normalizeHost,
  normalizePort,
  normalizeSha256Fingerprint,
  optionalSafeText,
  parseAlpnList,
  parseBoolFlag,
  parseSubscriptionUserInfoHeader,
  safeConfigText,
  sanitizeNodeName,
} from './parserUtils.js';
import { detectRegionAndMeta } from './regionDetector.js';

const SHARE_URI_PATTERN =
  /(?:ss|vmess|vless|trojan|hysteria2|hy2|tuic|wireguard|wg|snell|anytls):\/\/[^\s<>"']+/gi;

export type SubscriptionFormat = 'surge' | 'clash' | 'uri' | 'base64-uri';

export interface ParseSubscriptionResult {
  format: SubscriptionFormat;
  nodes: ParsedNodeInput[];
  filteredCount: number;
  skippedInvalidCount: number;
  userInfo: SubscriptionUserInfo;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function parsePositiveInt(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const match = String(value).trim().match(/^\d+/);
  if (!match) return undefined;
  const num = Number(match[0]);
  return Number.isInteger(num) && num > 0 ? num : undefined;
}

function parseReservedBytes(value: unknown): number[] | undefined {
  if (Array.isArray(value)) {
    const nums = value.map((item) => Number(item)).filter((item) => Number.isInteger(item) && item >= 0 && item <= 255);
    return nums.length === 3 ? nums : undefined;
  }
  if (typeof value === 'string' && value.trim()) {
    const nums = value
      .split(/[,\s/]+/)
      .map((item) => Number(item.trim()))
      .filter((item) => Number.isInteger(item) && item >= 0 && item <= 255);
    return nums.length === 3 ? nums : undefined;
  }
  return undefined;
}

function splitSurgeArgs(raw: string): string[] {
  const out: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let depth = 0;
  for (let index = 0; index < raw.length; index += 1) {
    const ch = raw[index];
    if (quote) {
      if (ch === quote && raw[index - 1] !== '\\') {
        quote = null;
      }
      current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === '[' || ch === '{' || ch === '(') {
      depth += 1;
      current += ch;
      continue;
    }
    if (ch === ']' || ch === '}' || ch === ')') {
      depth = Math.max(0, depth - 1);
      current += ch;
      continue;
    }
    if (ch === ',' && depth === 0) {
      out.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

function stripQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseSurgeSections(text: string): Map<string, string[]> {
  const sections = new Map<string, string[]>();
  let currentKey = '';
  let currentLines: string[] = [];

  const flush = () => {
    if (currentKey) {
      const prev = sections.get(currentKey) ?? [];
      sections.set(currentKey, [...prev, ...currentLines]);
    }
  };

  for (const line of text.split(/\r?\n/)) {
    const header = line.match(/^\s*\[([^\]\r\n]+)\]\s*$/);
    if (header) {
      flush();
      currentKey = header[1].trim().toLowerCase();
      currentLines = [];
    } else if (currentKey) {
      currentLines.push(line);
    }
  }
  flush();
  return sections;
}

function parseWireGuardSection(lines: string[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith(';')) continue;
    const idx = line.indexOf('=');
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const val = stripQuotes(line.slice(idx + 1).trim());
    map[key] = val;
  }
  return map;
}

function parseSurgeProxyLine(
  line: string,
  sections: Map<string, string[]>,
): RawParsedNode | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith(';')) return null;

  const eqIdx = trimmed.indexOf('=');
  if (eqIdx <= 0) return null;

  const rawName = trimmed.slice(0, eqIdx).trim();
  const rhs = trimmed.slice(eqIdx + 1).trim();
  const parts = splitSurgeArgs(rhs);
  if (parts.length < 1) return null;

  const rawType = parts[0].toLowerCase();
  if (['direct', 'reject', 'reject-tinygif', 'reject-drop', 'tailscale'].includes(rawType)) {
    return null;
  }

  const positional: string[] = [];
  const opts = new Map<string, string>();
  for (const token of parts.slice(1)) {
    const idx = token.indexOf('=');
    if (idx > 0) {
      const k = token.slice(0, idx).trim().toLowerCase();
      const v = stripQuotes(token.slice(idx + 1).trim());
      opts.set(k, v);
    } else if (token) {
      positional.push(stripQuotes(token));
    }
  }

  const shadowTlsPassword = optionalSafeText(opts.get('shadow-tls-password'));
  const shadowTlsVersionRaw = Number(opts.get('shadow-tls-version') ?? 3);
  const shadowTls: ShadowTlsOptions | undefined = shadowTlsPassword
    ? {
        version: shadowTlsVersionRaw === 2 ? 2 : 3,
        password: shadowTlsPassword,
        sni: optionalSafeText(opts.get('shadow-tls-sni')),
      }
    : undefined;

  const parseWsTransport = (): TransportOptions | undefined => {
    if (!parseBoolFlag(opts.get('ws'))) return undefined;
    const headersRaw = optionalSafeText(opts.get('ws-headers'));
    let host: string | undefined;
    const headers: Record<string, string> = {};
    if (headersRaw) {
      for (const pair of headersRaw.split('|')) {
        const colonIdx = pair.indexOf(':');
        if (colonIdx > 0) {
          const hk = pair.slice(0, colonIdx).trim();
          const hv = pair.slice(colonIdx + 1).trim();
          if (hk && hv) {
            headers[hk] = hv;
            if (hk.toLowerCase() === 'host') host = hv;
          }
        }
      }
    }
    return {
      type: 'ws',
      path: optionalSafeText(opts.get('ws-path')) ?? '/',
      host,
      headers: Object.keys(headers).length ? headers : undefined,
    };
  };

  try {
    if (rawType === 'wireguard') {
      const sectionName = opts.get('section-name');
      if (!sectionName) return null;
      const wgLines = sections.get(`wireguard ${sectionName.toLowerCase()}`);
      if (!wgLines) return null;
      const wg = parseWireGuardSection(wgLines);
      const peerRaw = wg['peer'] ?? '';
      const peerMatch = peerRaw.match(/\((.+)\)/);
      const peerMap = new Map<string, string>();
      for (const item of splitSurgeArgs(peerMatch ? peerMatch[1] : peerRaw)) {
        const idx = item.indexOf('=');
        if (idx > 0) {
          peerMap.set(item.slice(0, idx).trim().toLowerCase(), stripQuotes(item.slice(idx + 1).trim()));
        }
      }
      const endpoint = peerMap.get('endpoint') ?? '';
      const epMatch = endpoint.match(/^(\[[^\]]+\]|[^:]+):(\d+)$/);
      if (!epMatch) return null;
      const host = normalizeHost(epMatch[1]);
      const port = normalizePort(epMatch[2]);
      const wgPrivateKey = safeConfigText(wg['private-key']);
      const wgPublicKey = safeConfigText(peerMap.get('public-key'));
      return {
        name: rawName,
        config: {
          protocol: 'wireguard',
          host,
          port,
          wgPrivateKey,
          wgPublicKey,
          wgPresharedKey: optionalSafeText(peerMap.get('preshared-key')),
          wgSelfIp: optionalSafeText(wg['self-ip']),
          wgSelfIpV6: optionalSafeText(wg['self-ip-v6']),
          wgMtu: parsePositiveInt(wg['mtu']),
          wgReserved: parseReservedBytes(peerMap.get('client-id') ?? wg['reserved']),
          wgDns: wg['dns-server']
            ? wg['dns-server']
                .split(',')
                .map((item) => item.trim())
                .filter(Boolean)
            : undefined,
          udp: true,
        },
      };
    }

    if (positional.length < 2) return null;
    const host = normalizeHost(positional[0]);
    const port = normalizePort(positional[1]);
    const sni = optionalSafeText(opts.get('sni'));
    const skipCertVerify = parseBoolFlag(opts.get('skip-cert-verify'));
    const certFingerprintSha256 = normalizeSha256Fingerprint(
      opts.get('server-cert-fingerprint-sha256') ?? opts.get('pinsha256'),
    );
    const tfo = parseBoolFlag(opts.get('tfo'));
    const udp = parseBoolFlag(opts.get('udp-relay') ?? opts.get('udp'));

    if (rawType === 'ss') {
      const method = safeConfigText(opts.get('encrypt-method'));
      const password = safeConfigText(opts.get('password'));
      return {
        name: rawName,
        config: {
          protocol: 'ss',
          host,
          port,
          method,
          password,
          obfs: optionalSafeText(opts.get('obfs')),
          obfsHost: optionalSafeText(opts.get('obfs-host')),
          shadowTls,
          udp,
          tfo,
        },
      };
    }

    if (rawType === 'vmess') {
      const uuid = safeConfigText(opts.get('username') ?? opts.get('uuid'));
      return {
        name: rawName,
        config: {
          protocol: 'vmess',
          host,
          port,
          uuid,
          method: optionalSafeText(opts.get('encrypt-method')) ?? 'auto',
          aead: parseBoolFlag(opts.get('vmess-aead')) ?? true,
          alterId: parseBoolFlag(opts.get('vmess-aead')) === false ? 1 : 0,
          tls: parseBoolFlag(opts.get('tls')) ?? false,
          sni,
          skipCertVerify,
          certFingerprintSha256,
          transport: parseWsTransport(),
          udp,
          tfo,
        },
      };
    }

    if (rawType === 'vless') {
      const uuid = safeConfigText(opts.get('username') ?? opts.get('uuid'));
      return {
        name: rawName,
        config: {
          protocol: 'vless',
          host,
          port,
          uuid,
          tls: parseBoolFlag(opts.get('tls')) ?? false,
          sni,
          skipCertVerify,
          certFingerprintSha256,
          transport: parseWsTransport(),
          udp,
          tfo,
        },
      };
    }

    if (rawType === 'trojan') {
      const password = safeConfigText(opts.get('password'));
      return {
        name: rawName,
        config: {
          protocol: 'trojan',
          host,
          port,
          password,
          tls: true,
          sni: sni ?? host,
          skipCertVerify,
          certFingerprintSha256,
          transport: parseWsTransport(),
          udp,
          tfo,
        },
      };
    }

    if (rawType === 'hysteria2') {
      const password = safeConfigText(opts.get('password'));
      return {
        name: rawName,
        config: {
          protocol: 'hysteria2',
          host,
          port,
          password,
          tls: true,
          sni: sni ?? host,
          skipCertVerify,
          certFingerprintSha256,
          portHopping: optionalSafeText(opts.get('port-hopping')),
          portHoppingInterval: parsePositiveInt(opts.get('port-hopping-interval')),
          downMbps: parsePositiveInt(opts.get('download-bandwidth')),
          upMbps: parsePositiveInt(opts.get('upload-bandwidth')),
          obfs: optionalSafeText(opts.get('obfs')),
          obfsPassword: optionalSafeText(opts.get('obfs-password')),
          udp: true,
        },
      };
    }

    if (rawType === 'tuic' || rawType === 'tuic-v5') {
      const version: 4 | 5 = rawType === 'tuic-v5' || Boolean(opts.get('uuid')) ? 5 : 4;
      return {
        name: rawName,
        config: {
          protocol: 'tuic',
          host,
          port,
          tuicVersion: version,
          uuid: version === 5 ? safeConfigText(opts.get('uuid')) : undefined,
          password: version === 5 ? optionalSafeText(opts.get('password')) : undefined,
          token: version === 4 ? safeConfigText(opts.get('token') ?? opts.get('password')) : undefined,
          tls: true,
          sni: sni ?? host,
          alpn: parseAlpnList(opts.get('alpn')),
          skipCertVerify,
          certFingerprintSha256,
          congestionControl: optionalSafeText(opts.get('congestion-controller')),
          udpRelayMode: optionalSafeText(opts.get('udp-relay-mode')),
          udp: true,
        },
      };
    }

    if (rawType === 'snell') {
      const psk = safeConfigText(opts.get('psk'));
      return {
        name: rawName,
        config: {
          protocol: 'snell',
          host,
          port,
          psk,
          snellVersion: parsePositiveInt(opts.get('version')) ?? 4,
          obfs: optionalSafeText(opts.get('obfs')),
          obfsHost: optionalSafeText(opts.get('obfs-host')),
          shadowTls,
          reuse: parseBoolFlag(opts.get('reuse')),
          tfo,
        },
      };
    }

    if (rawType === 'anytls') {
      const password = safeConfigText(opts.get('password'));
      return {
        name: rawName,
        config: {
          protocol: 'anytls',
          host,
          port,
          password,
          tls: true,
          sni: sni ?? host,
          alpn: parseAlpnList(opts.get('alpn')),
          skipCertVerify,
          certFingerprintSha256,
          reuse: parseBoolFlag(opts.get('reuse')),
          tfo,
        },
      };
    }
  } catch {
    return null;
  }

  return null;
}

function parseClashTransport(proxy: Record<string, unknown>): TransportOptions | undefined {
  const rawNet = String(proxy.network ?? 'tcp').trim().toLowerCase();
  let type: TransportType | null = null;
  if (rawNet === 'ws' || rawNet === 'websocket') type = 'ws';
  else if (rawNet === 'grpc') type = 'grpc';
  else if (rawNet === 'httpupgrade') type = 'httpupgrade';
  else if (rawNet === 'xhttp' || rawNet === 'splithttp') type = 'xhttp';
  if (!type) return undefined;

  if (type === 'ws' || type === 'httpupgrade') {
    const wsOpts = asRecord(proxy['ws-opts']) ?? asRecord(proxy['httpupgrade-opts']) ?? {};
    const rawHeaders = asRecord(wsOpts.headers) ?? {};
    const headers: Record<string, string> = {};
    let host: string | undefined;
    for (const [k, v] of Object.entries(rawHeaders)) {
      const safeVal = optionalSafeText(v);
      if (safeVal) {
        headers[k] = safeVal;
        if (k.toLowerCase() === 'host') host = safeVal;
      }
    }
    return {
      type,
      path: optionalSafeText(wsOpts.path) ?? '/',
      host: host ?? optionalSafeText(wsOpts.host),
      headers: Object.keys(headers).length ? headers : undefined,
    };
  }

  if (type === 'grpc') {
    const grpcOpts = asRecord(proxy['grpc-opts']) ?? {};
    return {
      type: 'grpc',
      serviceName: optionalSafeText(grpcOpts['grpc-service-name'] ?? grpcOpts['service-name']),
      grpcMode: optionalSafeText(grpcOpts.mode) === 'multi' ? 'multi' : 'gun',
    };
  }

  const xhttpOpts = asRecord(proxy['xhttp-opts']) ?? {};
  const mode = optionalSafeText(xhttpOpts.mode);
  return {
    type: 'xhttp',
    path: optionalSafeText(xhttpOpts.path) ?? '/',
    host: optionalSafeText(xhttpOpts.host),
    xhttpMode:
      mode === 'auto' || mode === 'packet-up' || mode === 'stream-up' || mode === 'stream-one'
        ? mode
        : 'auto',
  };
}

function parseClashShadowTls(proxy: Record<string, unknown>): ShadowTlsOptions | undefined {
  const plugin = String(proxy.plugin ?? '').trim().toLowerCase();
  if (plugin === 'shadow-tls') {
    const opts = asRecord(proxy['plugin-opts']) ?? {};
    const password = optionalSafeText(opts.password);
    if (!password) return undefined;
    return {
      version: Number(opts.version) === 2 ? 2 : 3,
      password,
      sni: optionalSafeText(opts.host ?? opts.sni),
    };
  }
  return undefined;
}

function parseClashProxyItem(raw: unknown): RawParsedNode | null {
  const proxy = asRecord(raw);
  if (!proxy) return null;

  const rawName = String(proxy.name ?? '').trim();
  const rawType = String(proxy.type ?? '').trim().toLowerCase();
  if (!rawName || !rawType) return null;

  try {
    const host = normalizeHost(proxy.server);
    const port = normalizePort(proxy.port);
    const sni = optionalSafeText(proxy.sni ?? proxy.servername);
    const skipCertVerify = parseBoolFlag(proxy['skip-cert-verify']);
    const certFingerprintSha256 = normalizeSha256Fingerprint(
      proxy.fingerprint ?? proxy['server-cert-fingerprint-sha256'] ?? proxy.pinSHA256,
    );
    const clientFingerprint = optionalSafeText(proxy['client-fingerprint']);
    const alpn = parseAlpnList(proxy.alpn);
    const udp = parseBoolFlag(proxy.udp);
    const tfo = parseBoolFlag(proxy.tfo);

    if (rawType === 'ss') {
      const method = safeConfigText(proxy.cipher);
      const password = safeConfigText(proxy.password);
      const plugin = String(proxy.plugin ?? '').trim().toLowerCase();
      const pluginOpts = asRecord(proxy['plugin-opts']) ?? {};
      const obfs = plugin === 'obfs' ? optionalSafeText(pluginOpts.mode) : undefined;
      const obfsHost = plugin === 'obfs' ? optionalSafeText(pluginOpts.host) : undefined;
      return {
        name: rawName,
        config: {
          protocol: 'ss',
          host,
          port,
          method,
          password,
          obfs,
          obfsHost,
          shadowTls: parseClashShadowTls(proxy),
          udp,
          tfo,
        },
      };
    }

    if (rawType === 'vmess') {
      const uuid = safeConfigText(proxy.uuid);
      const alterId = Number(proxy.alterId ?? 0);
      return {
        name: rawName,
        config: {
          protocol: 'vmess',
          host,
          port,
          uuid,
          method: optionalSafeText(proxy.cipher) ?? 'auto',
          alterId: Number.isInteger(alterId) && alterId >= 0 ? alterId : 0,
          aead: !alterId,
          tls: parseBoolFlag(proxy.tls) ?? false,
          sni,
          alpn,
          skipCertVerify,
          certFingerprintSha256,
          clientFingerprint,
          transport: parseClashTransport(proxy),
          udp,
          tfo,
        },
      };
    }

    if (rawType === 'vless') {
      const uuid = safeConfigText(proxy.uuid);
      const realityOpts = asRecord(proxy['reality-opts']);
      const realityPub = realityOpts ? optionalSafeText(realityOpts['public-key']) : undefined;
      return {
        name: rawName,
        config: {
          protocol: 'vless',
          host,
          port,
          uuid,
          tls: parseBoolFlag(proxy.tls) ?? Boolean(realityPub),
          sni,
          alpn,
          skipCertVerify,
          certFingerprintSha256,
          clientFingerprint,
          flow: optionalSafeText(proxy.flow),
          reality: realityPub
            ? {
                publicKey: realityPub,
                shortId: optionalSafeText(realityOpts?.['short-id']),
                fingerprint: clientFingerprint ?? 'chrome',
              }
            : undefined,
          transport: parseClashTransport(proxy),
          udp,
          tfo,
        },
      };
    }

    if (rawType === 'trojan') {
      const password = safeConfigText(proxy.password);
      return {
        name: rawName,
        config: {
          protocol: 'trojan',
          host,
          port,
          password,
          tls: true,
          sni: sni ?? host,
          alpn,
          skipCertVerify,
          certFingerprintSha256,
          clientFingerprint,
          transport: parseClashTransport(proxy),
          udp,
          tfo,
        },
      };
    }

    if (rawType === 'hysteria2') {
      const password = safeConfigText(proxy.password);
      return {
        name: rawName,
        config: {
          protocol: 'hysteria2',
          host,
          port,
          password,
          tls: true,
          sni: sni ?? host,
          alpn,
          skipCertVerify,
          certFingerprintSha256,
          portHopping: optionalSafeText(proxy.ports),
          portHoppingInterval: parsePositiveInt(proxy['hop-interval']),
          downMbps: parsePositiveInt(proxy.down),
          upMbps: parsePositiveInt(proxy.up),
          obfs: optionalSafeText(proxy.obfs),
          obfsPassword: optionalSafeText(proxy['obfs-password']),
          udp: true,
        },
      };
    }

    if (rawType === 'tuic') {
      const uuid = optionalSafeText(proxy.uuid);
      const token = optionalSafeText(proxy.token);
      const version: 4 | 5 = uuid ? 5 : 4;
      if (version === 5 && !uuid) return null;
      if (version === 4 && !token) return null;
      return {
        name: rawName,
        config: {
          protocol: 'tuic',
          host,
          port,
          tuicVersion: version,
          uuid,
          password: optionalSafeText(proxy.password),
          token,
          tls: true,
          sni: sni ?? host,
          alpn,
          skipCertVerify,
          certFingerprintSha256,
          congestionControl: optionalSafeText(proxy['congestion-controller']),
          udpRelayMode: optionalSafeText(proxy['udp-relay-mode']),
          udp: true,
        },
      };
    }

    if (rawType === 'wireguard') {
      const wgPrivateKey = safeConfigText(proxy['private-key']);
      const wgPublicKey = safeConfigText(proxy['public-key']);
      return {
        name: rawName,
        config: {
          protocol: 'wireguard',
          host,
          port,
          wgPrivateKey,
          wgPublicKey,
          wgPresharedKey: optionalSafeText(proxy['pre-shared-key'] ?? proxy['preshared-key']),
          wgSelfIp: optionalSafeText(proxy.ip),
          wgSelfIpV6: optionalSafeText(proxy.ipv6),
          wgReserved: parseReservedBytes(proxy.reserved),
          wgMtu: parsePositiveInt(proxy.mtu),
          wgDns: Array.isArray(proxy.dns)
            ? proxy.dns.map((item) => optionalSafeText(item)).filter((item): item is string => Boolean(item))
            : undefined,
          udp: true,
        },
      };
    }

    if (rawType === 'snell') {
      const psk = safeConfigText(proxy.psk);
      const obfsOpts = asRecord(proxy['obfs-opts']) ?? {};
      return {
        name: rawName,
        config: {
          protocol: 'snell',
          host,
          port,
          psk,
          snellVersion: parsePositiveInt(proxy.version) ?? 3,
          obfs: optionalSafeText(obfsOpts.mode),
          obfsHost: optionalSafeText(obfsOpts.host),
          shadowTls: parseClashShadowTls(proxy),
          tfo,
        },
      };
    }

    if (rawType === 'anytls') {
      const password = safeConfigText(proxy.password);
      return {
        name: rawName,
        config: {
          protocol: 'anytls',
          host,
          port,
          password,
          tls: true,
          sni: sni ?? host,
          alpn,
          skipCertVerify,
          certFingerprintSha256,
          clientFingerprint,
          idleSessionCheckInterval: parsePositiveInt(proxy['idle-session-check-interval']),
          idleSessionTimeout: parsePositiveInt(proxy['idle-session-timeout']),
          minIdleSession: parsePositiveInt(proxy['min-idle-session']),
          udp,
          tfo,
        },
      };
    }
  } catch {
    return null;
  }

  return null;
}

function tryParseClashYaml(text: string): RawParsedNode[] | null {
  if (!/^\s*proxies\s*:/m.test(text)) return null;
  try {
    const parsed = parseYaml(text);
    const doc = asRecord(parsed);
    if (!doc || !Array.isArray(doc.proxies)) return null;
    const out: RawParsedNode[] = [];
    for (const item of doc.proxies) {
      const node = parseClashProxyItem(item);
      if (node) out.push(node);
    }
    return out;
  } catch {
    return null;
  }
}

function tryParseSurgeText(text: string): RawParsedNode[] | null {
  const sections = parseSurgeSections(text);
  const proxyLines = sections.get('proxy');
  if (proxyLines && proxyLines.length) {
    const out: RawParsedNode[] = [];
    for (const line of proxyLines) {
      const node = parseSurgeProxyLine(line, sections);
      if (node) out.push(node);
    }
    return out;
  }

  // Standalone Surge proxy lines (for manual import)
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && !line.startsWith(';'));
  const standalone: RawParsedNode[] = [];
  for (const line of lines) {
    if (/^[a-z0-9+.-]+:\/\//i.test(line)) continue;
    if (line.includes('=') && line.includes(',')) {
      const node = parseSurgeProxyLine(line, sections);
      if (node) standalone.push(node);
    }
  }
  return standalone.length ? standalone : null;
}

function finalizeParsedNodes(
  rawNodes: RawParsedNode[],
  format: SubscriptionFormat,
  options: { filterNotices?: boolean; userInfoHeader?: string; skippedInvalidCount?: number },
): ParseSubscriptionResult {
  const filterNotices = options.filterNotices ?? true;
  const baseUserInfo = parseSubscriptionUserInfoHeader(options.userInfoHeader);
  const noticeNames: string[] = [];
  const nodes: ParsedNodeInput[] = [];
  let filteredCount = 0;

  for (const raw of rawNodes) {
    const cleanName = sanitizeNodeName(raw.name) || `${raw.config.protocol}-${raw.config.host}:${raw.config.port}`;
    if (isInformationalNodeName(cleanName)) {
      noticeNames.push(cleanName);
      if (filterNotices) {
        filteredCount += 1;
        continue;
      }
    }

    const meta = detectRegionAndMeta(cleanName, raw.config.host);
    nodes.push({
      fingerprint: computeNodeFingerprint(raw.config),
      originalName: cleanName,
      protocol: raw.config.protocol,
      host: raw.config.host,
      port: raw.config.port,
      config: raw.config,
      detectedRegion: meta.region,
      multiplier: meta.multiplier,
      tags: meta.tags,
    });
  }

  const userInfo = extractUserInfoFromNoticeNames(noticeNames, baseUserInfo);
  return {
    format,
    nodes,
    filteredCount,
    skippedInvalidCount: options.skippedInvalidCount ?? 0,
    userInfo,
  };
}

export function parseSubscriptionPayload(
  body: string,
  options: { filterNotices?: boolean; userInfoHeader?: string } = {},
): ParseSubscriptionResult {
  const raw = String(body ?? '').replace(/^\uFEFF/, '').trim();
  if (!raw) {
    throw new Error('订阅或导入内容为空');
  }

  const candidates: Array<{ text: string; fromBase64: boolean }> = [{ text: raw, fromBase64: false }];
  const decoded = decodeBase64Safe(raw);
  if (decoded && decoded !== raw) {
    candidates.push({ text: decoded, fromBase64: true });
  }

  for (const candidate of candidates) {
    const clashNodes = tryParseClashYaml(candidate.text);
    if (clashNodes !== null && clashNodes.length > 0) {
      return finalizeParsedNodes(clashNodes, 'clash', options);
    }

    const surgeNodes = tryParseSurgeText(candidate.text);
    if (surgeNodes !== null && surgeNodes.length > 0) {
      return finalizeParsedNodes(surgeNodes, 'surge', options);
    }

    const uris = candidate.text.match(SHARE_URI_PATTERN) ?? [];
    if (uris.length > 0) {
      const parsed: RawParsedNode[] = [];
      let skippedInvalidCount = 0;
      for (const uri of uris) {
        const node = parseSingleShareUri(uri);
        if (node) parsed.push(node);
        else skippedInvalidCount += 1;
      }
      if (parsed.length > 0) {
        return finalizeParsedNodes(parsed, candidate.fromBase64 ? 'base64-uri' : 'uri', {
          ...options,
          skippedInvalidCount,
        });
      }
    }
  }

  throw new Error('未能识别有效的节点（支持 Base64、分享链接 URI、Clash YAML 与 Surge [Proxy] 格式）');
}
