import type { ProxyNodeConfig, TransportOptions, TransportType } from '../../shared/types.js';
import {
  decodeBase64Safe,
  decodeUriPart,
  normalizeHost,
  normalizePort,
  normalizeSha256Fingerprint,
  optionalSafeText,
  parseAlpnList,
  parseBoolFlag,
  safeConfigText,
} from './parserUtils.js';

export interface RawParsedNode {
  name: string;
  config: ProxyNodeConfig;
}

function parseTransportFromParams(params: URLSearchParams): TransportOptions | undefined {
  const rawType = (params.get('type') ?? params.get('net') ?? 'tcp').trim().toLowerCase();
  let type: TransportType = 'tcp';
  if (rawType === 'ws' || rawType === 'websocket') type = 'ws';
  else if (rawType === 'grpc') type = 'grpc';
  else if (rawType === 'httpupgrade') type = 'httpupgrade';
  else if (rawType === 'xhttp' || rawType === 'splithttp') type = 'xhttp';
  else return undefined;

  const path = optionalSafeText(params.get('path'));
  const host = optionalSafeText(params.get('host'));
  const serviceName = optionalSafeText(params.get('serviceName') ?? params.get('service-name'));
  const authority = optionalSafeText(params.get('authority'));
  const mode = optionalSafeText(params.get('mode'));

  return {
    type,
    path,
    host,
    serviceName,
    authority,
    grpcMode: type === 'grpc' && mode === 'multi' ? 'multi' : type === 'grpc' ? 'gun' : undefined,
    xhttpMode:
      type === 'xhttp' &&
      (mode === 'auto' || mode === 'packet-up' || mode === 'stream-up' || mode === 'stream-one')
        ? mode
        : undefined,
  };
}

function parseShadowsocksPlugin(
  pluginRaw: string | null,
  config: ProxyNodeConfig,
): void {
  if (!pluginRaw) return;
  const parts = pluginRaw.split(';').map((item) => item.trim()).filter(Boolean);
  const pluginName = parts[0]?.toLowerCase() ?? '';
  const kv = new Map<string, string>();
  for (const part of parts.slice(1)) {
    const idx = part.indexOf('=');
    if (idx > 0) {
      kv.set(part.slice(0, idx).trim().toLowerCase(), part.slice(idx + 1).trim());
    }
  }
  if (pluginName.includes('obfs')) {
    config.obfs = optionalSafeText(kv.get('obfs'));
    config.obfsHost = optionalSafeText(kv.get('obfs-host'));
  } else if (pluginName.includes('shadow-tls') || pluginName.includes('shadowtls')) {
    const version = Number(kv.get('version') ?? '3') === 2 ? 2 : 3;
    const password = optionalSafeText(kv.get('password') ?? kv.get('passwd'));
    if (password) {
      config.shadowTls = {
        version,
        password,
        sni: optionalSafeText(kv.get('host') ?? kv.get('sni')),
      };
    }
  }
}

function parseSsUri(uri: string): RawParsedNode {
  const hashIdx = uri.indexOf('#');
  const name = hashIdx >= 0 ? decodeUriPart(uri.slice(hashIdx + 1)) : '';
  const body = hashIdx >= 0 ? uri.slice(5, hashIdx) : uri.slice(5);
  const qIdx = body.indexOf('?');
  const mainPart = qIdx >= 0 ? body.slice(0, qIdx) : body;
  const query = new URLSearchParams(qIdx >= 0 ? body.slice(qIdx + 1) : '');

  let method = '';
  let password = '';
  let host = '';
  let port = 0;

  if (mainPart.includes('@')) {
    const atIdx = mainPart.lastIndexOf('@');
    const userInfoRaw = mainPart.slice(0, atIdx);
    const hostPortRaw = mainPart.slice(atIdx + 1);
    const decodedUser = userInfoRaw.includes(':')
      ? decodeUriPart(userInfoRaw)
      : decodeBase64Safe(userInfoRaw) ?? decodeUriPart(userInfoRaw);
    const colonIdx = decodedUser.indexOf(':');
    if (colonIdx <= 0) throw new Error('Invalid SS credentials');
    method = safeConfigText(decodedUser.slice(0, colonIdx)).toLowerCase();
    password = safeConfigText(decodedUser.slice(colonIdx + 1));
    const parsedUrl = new URL(`ss://u@${hostPortRaw}`);
    host = normalizeHost(parsedUrl.hostname);
    port = normalizePort(parsedUrl.port);
  } else {
    const decoded = decodeBase64Safe(mainPart);
    if (!decoded) throw new Error('Invalid legacy SS URI');
    const atIdx = decoded.lastIndexOf('@');
    if (atIdx <= 0) throw new Error('Invalid legacy SS URI');
    const userPart = decoded.slice(0, atIdx);
    const colonIdx = userPart.indexOf(':');
    if (colonIdx <= 0) throw new Error('Invalid SS credentials');
    method = safeConfigText(userPart.slice(0, colonIdx)).toLowerCase();
    password = safeConfigText(userPart.slice(colonIdx + 1));
    const parsedUrl = new URL(`ss://u@${decoded.slice(atIdx + 1)}`);
    host = normalizeHost(parsedUrl.hostname);
    port = normalizePort(parsedUrl.port);
  }

  const config: ProxyNodeConfig = {
    protocol: 'ss',
    host,
    port,
    method,
    password,
    udp: true,
  };
  parseShadowsocksPlugin(query.get('plugin'), config);
  return { name: name || `${host}:${port}`, config };
}

function parseVmessUri(uri: string): RawParsedNode {
  const raw = uri.slice('vmess://'.length).trim();
  const decoded = decodeBase64Safe(raw);
  if (!decoded) throw new Error('Invalid VMess base64 payload');
  const obj = JSON.parse(decoded) as Record<string, unknown>;
  const host = normalizeHost(obj.add);
  const port = normalizePort(obj.port);
  const uuid = safeConfigText(obj.id);
  const netType = String(obj.net ?? 'tcp').toLowerCase();
  const tlsEnabled = parseBoolFlag(obj.tls) ?? false;

  let transport: TransportOptions | undefined;
  if (netType === 'ws' || netType === 'grpc' || netType === 'httpupgrade' || netType === 'xhttp') {
    transport = {
      type: netType,
      path: optionalSafeText(obj.path),
      host: optionalSafeText(obj.host),
      serviceName: netType === 'grpc' ? optionalSafeText(obj.path) : undefined,
    };
  }

  const config: ProxyNodeConfig = {
    protocol: 'vmess',
    host,
    port,
    uuid,
    method: optionalSafeText(obj.scy ?? obj.cipher) ?? 'auto',
    alterId: Number.isFinite(Number(obj.aid)) ? Number(obj.aid) : 0,
    aead: Number(obj.aid ?? 0) === 0,
    tls: tlsEnabled,
    sni: optionalSafeText(obj.sni ?? obj.host),
    alpn: parseAlpnList(obj.alpn),
    skipCertVerify: parseBoolFlag(obj.skipCertVerify ?? obj.insecure),
    clientFingerprint: optionalSafeText(obj.fp),
    transport,
    udp: true,
  };
  return { name: optionalSafeText(obj.ps) ?? `${host}:${port}`, config };
}

function parseVlessUri(uri: string): RawParsedNode {
  const url = new URL(uri);
  const host = normalizeHost(url.hostname);
  const port = normalizePort(url.port);
  const uuid = safeConfigText(decodeUriPart(url.username));
  const params = url.searchParams;
  const security = (params.get('security') ?? 'none').toLowerCase();
  const pbk = optionalSafeText(params.get('pbk'));

  const config: ProxyNodeConfig = {
    protocol: 'vless',
    host,
    port,
    uuid,
    flow: optionalSafeText(params.get('flow')),
    tls: security === 'tls' || security === 'reality',
    sni: optionalSafeText(params.get('sni')),
    alpn: parseAlpnList(params.get('alpn')),
    skipCertVerify: parseBoolFlag(params.get('allowInsecure') ?? params.get('insecure')),
    clientFingerprint: optionalSafeText(params.get('fp')),
    transport: parseTransportFromParams(params),
    udp: true,
  };

  if (security === 'reality' && pbk) {
    config.reality = {
      publicKey: pbk,
      shortId: optionalSafeText(params.get('sid')),
      fingerprint: optionalSafeText(params.get('fp')),
      spiderX: optionalSafeText(params.get('spx')),
    };
  }

  return { name: decodeUriPart(url.hash.slice(1)) || `${host}:${port}`, config };
}

function parseTrojanUri(uri: string): RawParsedNode {
  const url = new URL(uri);
  const host = normalizeHost(url.hostname);
  const port = normalizePort(url.port);
  const password = safeConfigText(decodeUriPart(url.username));
  const params = url.searchParams;

  const config: ProxyNodeConfig = {
    protocol: 'trojan',
    host,
    port,
    password,
    tls: true,
    sni: optionalSafeText(params.get('sni') ?? params.get('peer')),
    alpn: parseAlpnList(params.get('alpn')),
    skipCertVerify: parseBoolFlag(params.get('allowInsecure') ?? params.get('insecure')),
    clientFingerprint: optionalSafeText(params.get('fp')),
    transport: parseTransportFromParams(params),
    udp: true,
  };
  return { name: decodeUriPart(url.hash.slice(1)) || `${host}:${port}`, config };
}

function parseHysteria2Uri(uri: string): RawParsedNode {
  const normalized = uri.replace(/^hy2:\/\//i, 'hysteria2://');
  const url = new URL(normalized);
  const host = normalizeHost(url.hostname);
  const port = normalizePort(url.port || 443);
  const rawAuth = url.password
    ? `${decodeUriPart(url.username)}:${decodeUriPart(url.password)}`
    : decodeUriPart(url.username);
  const password = safeConfigText(rawAuth);
  const params = url.searchParams;

  const config: ProxyNodeConfig = {
    protocol: 'hysteria2',
    host,
    port,
    password,
    tls: true,
    sni: optionalSafeText(params.get('sni')),
    alpn: parseAlpnList(params.get('alpn')),
    skipCertVerify: parseBoolFlag(params.get('insecure') ?? params.get('allowInsecure')),
    certFingerprintSha256: normalizeSha256Fingerprint(
      params.get('pinSHA256') ?? params.get('pinsha256') ?? params.get('fingerprint'),
    ),
    obfs: optionalSafeText(params.get('obfs')),
    obfsPassword: optionalSafeText(params.get('obfs-password')),
    portHopping: optionalSafeText(params.get('mport') ?? params.get('ports')),
    udp: true,
  };
  return { name: decodeUriPart(url.hash.slice(1)) || `${host}:${port}`, config };
}

function parseTuicUri(uri: string): RawParsedNode {
  const url = new URL(uri);
  const host = normalizeHost(url.hostname);
  const port = normalizePort(url.port || 443);
  const params = url.searchParams;
  const hasPassword = Boolean(url.password);
  const uuid = hasPassword ? safeConfigText(decodeUriPart(url.username)) : undefined;
  const password = hasPassword ? safeConfigText(decodeUriPart(url.password)) : undefined;
  const token = !hasPassword ? safeConfigText(decodeUriPart(url.username)) : undefined;

  const config: ProxyNodeConfig = {
    protocol: 'tuic',
    host,
    port,
    tuicVersion: hasPassword ? 5 : 4,
    uuid,
    password,
    token,
    tls: true,
    sni: optionalSafeText(params.get('sni')),
    alpn: parseAlpnList(params.get('alpn')),
    skipCertVerify: parseBoolFlag(params.get('allow_insecure') ?? params.get('insecure')),
    congestionControl: optionalSafeText(params.get('congestion_control') ?? params.get('cc')),
    udpRelayMode: optionalSafeText(params.get('udp_relay_mode')),
    udp: true,
  };
  return { name: decodeUriPart(url.hash.slice(1)) || `${host}:${port}`, config };
}

function parseWireGuardUri(uri: string): RawParsedNode {
  const normalized = uri.replace(/^wg:\/\//i, 'wireguard://');
  const url = new URL(normalized);
  const host = normalizeHost(url.hostname);
  const port = normalizePort(url.port || 51820);
  const params = url.searchParams;
  const wgPrivateKey = safeConfigText(decodeUriPart(url.username));
  const wgPublicKey = safeConfigText(params.get('publickey') ?? params.get('publicKey'));
  const addressRaw = optionalSafeText(params.get('address')) ?? '10.0.0.2/32';
  const addresses = addressRaw.split(',').map((item) => item.trim());
  const wgSelfIp = addresses.find((addr) => !addr.includes(':')) ?? addresses[0];
  const wgSelfIpV6 = addresses.find((addr) => addr.includes(':'));
  const reservedRaw = optionalSafeText(params.get('reserved'));
  const wgReserved = reservedRaw
    ? reservedRaw
        .split(',')
        .map((n) => Number(n.trim()))
        .filter((n) => Number.isInteger(n) && n >= 0 && n <= 255)
    : undefined;

  const config: ProxyNodeConfig = {
    protocol: 'wireguard',
    host,
    port,
    wgPrivateKey,
    wgPublicKey,
    wgPresharedKey: optionalSafeText(params.get('presharedkey') ?? params.get('psk')),
    wgSelfIp,
    wgSelfIpV6,
    wgReserved: wgReserved?.length === 3 ? wgReserved : undefined,
    wgMtu: Number.isFinite(Number(params.get('mtu'))) ? Number(params.get('mtu')) : undefined,
    udp: true,
  };
  return { name: decodeUriPart(url.hash.slice(1)) || `${host}:${port}`, config };
}

function parseSnellUri(uri: string): RawParsedNode {
  const url = new URL(uri);
  const host = normalizeHost(url.hostname);
  const port = normalizePort(url.port);
  const params = url.searchParams;
  const psk = safeConfigText(decodeUriPart(url.username) || params.get('psk'));
  const version = Number(params.get('version') ?? '4');

  const config: ProxyNodeConfig = {
    protocol: 'snell',
    host,
    port,
    psk,
    snellVersion: Number.isInteger(version) && version >= 2 && version <= 5 ? version : 4,
    obfs: optionalSafeText(params.get('obfs')),
    obfsHost: optionalSafeText(params.get('obfs-host')),
    reuse: parseBoolFlag(params.get('reuse')),
  };
  return { name: decodeUriPart(url.hash.slice(1)) || `${host}:${port}`, config };
}

function parseAnyTlsUri(uri: string): RawParsedNode {
  const url = new URL(uri);
  const host = normalizeHost(url.hostname);
  const port = normalizePort(url.port || 443);
  const password = safeConfigText(decodeUriPart(url.username));
  const params = url.searchParams;

  const config: ProxyNodeConfig = {
    protocol: 'anytls',
    host,
    port,
    password,
    tls: true,
    sni: optionalSafeText(params.get('sni')),
    alpn: parseAlpnList(params.get('alpn')),
    skipCertVerify: parseBoolFlag(params.get('insecure') ?? params.get('allowInsecure')),
    clientFingerprint: optionalSafeText(params.get('fp')),
    udp: true,
  };
  return { name: decodeUriPart(url.hash.slice(1)) || `${host}:${port}`, config };
}

export function parseSingleShareUri(uri: string): RawParsedNode | null {
  const trimmed = uri.trim();
  const schemeMatch = trimmed.match(/^([a-z0-9]+):\/\//i);
  if (!schemeMatch) return null;
  const scheme = schemeMatch[1].toLowerCase();
  try {
    switch (scheme) {
      case 'ss':
        return parseSsUri(trimmed);
      case 'vmess':
        return parseVmessUri(trimmed);
      case 'vless':
        return parseVlessUri(trimmed);
      case 'trojan':
        return parseTrojanUri(trimmed);
      case 'hysteria2':
      case 'hy2':
        return parseHysteria2Uri(trimmed);
      case 'tuic':
        return parseTuicUri(trimmed);
      case 'wireguard':
      case 'wg':
        return parseWireGuardUri(trimmed);
      case 'snell':
        return parseSnellUri(trimmed);
      case 'anytls':
        return parseAnyTlsUri(trimmed);
      default:
        return null;
    }
  } catch {
    return null;
  }
}
