import crypto from 'node:crypto';
import net from 'node:net';
import { domainToASCII } from 'node:url';
import type { ProxyNodeConfig, SubscriptionUserInfo } from '../../shared/types.js';

const INFORMATIONAL_PROXY_NAME_PATTERN =
  /(?:剩余流量|距离下次重置|套餐到期|到期时间|过期时间|流量重置|当前网址|最新网址|永久网址|防失联|续费(?:网址|地址|链接)|官网(?:网址|地址)|订阅(?:信息|地址|链接)|流量查询|客服|群组|频道|通知|公告)|^(?:remain(?:ing)?(?:\s+traffic)?|expired?|reset|traffic|expire|website|official)(?:\b|[_：:])/iu;

const CLIENT_INSTRUCTION_PROXY_NAME_PATTERN =
  /^(?:(?:推荐(?:clash|karing|小火箭|客户端)|surge客户端不支持|若无[^,]*更换客户端)|(?:安卓|android|windows|电脑|pc|ios|iphone|ipad|mac|小火箭|shadowrocket|clash(?:meta|verge)?)[^,]*客户端)/iu;

export function isInformationalNodeName(name: string): boolean {
  const normalized = String(name ?? '').trim();
  if (!normalized) return false;
  return (
    INFORMATIONAL_PROXY_NAME_PATTERN.test(normalized) ||
    CLIENT_INSTRUCTION_PROXY_NAME_PATTERN.test(normalized)
  );
}

// Preserves original name & slashes while stripping newlines, control chars, and config-breaking delimiters
export function sanitizeNodeName(value: string): string {
  const cleaned = String(value ?? '')
    .replace(/[\r\n\u0000-\u001F\u007F]/g, ' ')
    .replace(/[=,;#]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 96);
  return cleaned;
}

export function safeConfigText(value: unknown): string {
  const text = String(value ?? '').trim();
  if (!text || /[\r\n\u0000-\u001F\u007F]/.test(text)) {
    throw new Error('Invalid config value');
  }
  return text;
}

export function optionalSafeText(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  const text = String(value).trim();
  if (!text || /[\r\n\u0000-\u001F\u007F]/.test(text)) return undefined;
  return text;
}

export function normalizeHost(value: unknown): string {
  let host = String(value ?? '').trim();
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  if (!host || /[\s,;#/?@\r\n\u0000]/.test(host)) {
    throw new Error('Invalid server host');
  }
  if (net.isIP(host)) return host.toLowerCase();
  const ascii = domainToASCII(host).toLowerCase();
  const labels = ascii.split('.');
  if (
    !ascii ||
    ascii.length > 253 ||
    !/^[a-z0-9.-]+$/.test(ascii) ||
    labels.some((label) => !label || label.startsWith('-') || label.endsWith('-'))
  ) {
    throw new Error('Invalid server host');
  }
  return ascii;
}

export function normalizePort(value: unknown): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('Invalid server port');
  }
  return port;
}

export function decodeUriPart(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function decodeBase64Safe(raw: string): string | null {
  const compact = raw.replace(/\s+/g, '');
  if (compact.length < 8 || !/^[A-Za-z0-9+/_-]+={0,2}$/.test(compact)) {
    return null;
  }
  try {
    const normalized = compact.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=');
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(
      Buffer.from(padded, 'base64'),
    );
    return decoded || null;
  } catch {
    return null;
  }
}

export function parseBoolFlag(value: unknown): boolean | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const str = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on', 'tls'].includes(str)) return true;
  if (['0', 'false', 'no', 'off', 'none'].includes(str)) return false;
  return undefined;
}

export function parseAlpnList(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    const list = value.map((item) => optionalSafeText(item)).filter((item): item is string => Boolean(item));
    return list.length ? list : undefined;
  }
  if (typeof value === 'string' && value.trim()) {
    const list = value
      .split(',')
      .map((item) => optionalSafeText(item))
      .filter((item): item is string => Boolean(item));
    return list.length ? list : undefined;
  }
  return undefined;
}

export function normalizeSha256Fingerprint(value: unknown): string | undefined {
  const raw = optionalSafeText(value);
  if (!raw) return undefined;
  const stripped = raw.replace(/^sha-?256:/i, '').replace(/:/g, '').trim();
  if (/^[0-9a-fA-F]{64}$/.test(stripped)) {
    return stripped.toLowerCase();
  }
  return raw;
}

export function computeNodeFingerprint(config: ProxyNodeConfig): string {
  const keyParts = [
    config.protocol,
    config.host.toLowerCase(),
    String(config.port),
    config.uuid ?? config.password ?? config.psk ?? config.token ?? config.wgPublicKey ?? '',
    config.method ?? '',
    config.sni ?? '',
    config.transport?.type ?? 'tcp',
    config.transport?.path ?? config.transport?.serviceName ?? '',
    config.reality?.publicKey ?? '',
    config.shadowTls?.sni ?? '',
  ];
  return crypto.createHash('sha256').update(keyParts.join('|'), 'utf8').digest('hex').slice(0, 32);
}

export function parseSubscriptionUserInfoHeader(
  headerValue: string | undefined,
): SubscriptionUserInfo {
  if (!headerValue) return {};
  const info: SubscriptionUserInfo = {};
  for (const part of headerValue.split(';')) {
    const [k, v] = part.split('=').map((item) => item.trim());
    if (!k || !v) continue;
    const num = Number(v);
    if (!Number.isFinite(num) || num < 0) continue;
    const key = k.toLowerCase();
    if (key === 'upload') info.upload = Math.round(num);
    else if (key === 'download') info.download = Math.round(num);
    else if (key === 'total') info.total = Math.round(num);
    else if (key === 'expire') info.expire = Math.round(num);
  }
  return info;
}

export function extractUserInfoFromNoticeNames(
  names: string[],
  base: SubscriptionUserInfo,
): SubscriptionUserInfo {
  const info: SubscriptionUserInfo = { ...base };
  for (const name of names) {
    if (info.expire === undefined) {
      const dateMatch = name.match(/(?:到期|过期|expire)[^0-9]*(\d{4}[-/.]\d{1,2}[-/.]\d{1,2})/iu);
      if (dateMatch) {
        const parsed = Date.parse(dateMatch[1].replace(/[/.]/g, '-'));
        if (!Number.isNaN(parsed)) {
          info.expire = Math.floor(parsed / 1000);
        }
      }
    }
    if (info.total === undefined) {
      const remainMatch = name.match(
        /(?:剩余流量|remain(?:ing)?(?:\s+traffic)?)[^0-9]*(\d+(?:\.\d+)?)\s*(TB|GB|MB|T|G|M)/iu,
      );
      if (remainMatch) {
        const amount = Number(remainMatch[1]);
        const unit = remainMatch[2].toUpperCase();
        const multiplier =
          unit.startsWith('T')
            ? 1024 ** 4
            : unit.startsWith('G')
              ? 1024 ** 3
              : 1024 ** 2;
        if (Number.isFinite(amount)) {
          info.total = Math.round(amount * multiplier);
          info.upload = info.upload ?? 0;
          info.download = info.download ?? 0;
        }
      }
    }
  }
  return info;
}
