import dns from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { domainToASCII } from 'node:url';

const MAX_REDIRECTS = 5;
const MAX_BODY_BYTES = 5 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 15_000;

export class SsrfBlockedError extends Error {
  readonly statusCode = 400;
  constructor(message: string) {
    super(message);
    this.name = 'SsrfBlockedError';
  }
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let out = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const num = Number(part);
    if (num < 0 || num > 255) return null;
    out = ((out << 8) | num) >>> 0;
  }
  return out;
}

function inCidrV4(ipInt: number, base: string, prefix: number): boolean {
  const baseInt = ipv4ToInt(base);
  if (baseInt === null) return false;
  const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
  return (ipInt & mask) === (baseInt & mask);
}

export function isPrivateOrReservedIp(ipRaw: string): boolean {
  const ip = ipRaw.trim().toLowerCase().replace(/^\[|\]$/g, '');
  const version = net.isIP(ip);
  if (version === 4) {
    const ipInt = ipv4ToInt(ip);
    if (ipInt === null) return true;
    return (
      inCidrV4(ipInt, '0.0.0.0', 8) ||
      inCidrV4(ipInt, '10.0.0.0', 8) ||
      inCidrV4(ipInt, '100.64.0.0', 10) ||
      inCidrV4(ipInt, '127.0.0.0', 8) ||
      inCidrV4(ipInt, '169.254.0.0', 16) ||
      inCidrV4(ipInt, '172.16.0.0', 12) ||
      inCidrV4(ipInt, '192.0.0.0', 24) ||
      inCidrV4(ipInt, '192.0.2.0', 24) ||
      inCidrV4(ipInt, '192.168.0.0', 16) ||
      inCidrV4(ipInt, '198.18.0.0', 15) ||
      inCidrV4(ipInt, '198.51.100.0', 24) ||
      inCidrV4(ipInt, '203.0.113.0', 24) ||
      inCidrV4(ipInt, '224.0.0.0', 4) ||
      inCidrV4(ipInt, '240.0.0.0', 4)
    );
  }
  if (version === 6) {
    const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
    if (mapped) {
      return isPrivateOrReservedIp(mapped[1]);
    }
    if (ip === '::' || ip === '::1') return true;
    const firstHex = ip.split(':')[0] || '0';
    const firstHextet = Number.parseInt(firstHex, 16);
    if (Number.isNaN(firstHextet)) return true;
    if ((firstHextet & 0xfe00) === 0xfc00) return true; // fc00::/7 ULA
    if ((firstHextet & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
    if ((firstHextet & 0xff00) === 0xff00) return true; // ff00::/8 multicast
    if (ip.startsWith('64:ff9b::') || ip.startsWith('2001:db8:')) return true;
    return false;
  }
  return true;
}

export interface ValidatedHost {
  hostname: string;
  address: string;
  family: 4 | 6;
}

export async function validateTargetHost(
  rawHost: string,
  allowPrivate: boolean,
): Promise<ValidatedHost> {
  const host = rawHost.trim().replace(/^\[|\]$/g, '');
  if (!host) throw new SsrfBlockedError('目标主机名不能为空');

  const lower = host.toLowerCase();
  if (!allowPrivate && (lower === 'localhost' || lower.endsWith('.localhost') || lower.endsWith('.local'))) {
    throw new SsrfBlockedError('禁止访问本地或内网域名（可设置 ALLOW_PRIVATE_FETCH=true 显式放行）');
  }

  const ipVersion = net.isIP(host);
  if (ipVersion === 4 || ipVersion === 6) {
    if (!allowPrivate && isPrivateOrReservedIp(host)) {
      throw new SsrfBlockedError('禁止访问私网、回环、链路本地或 Fake-IP 地址');
    }
    return { hostname: host, address: host, family: ipVersion };
  }

  const ascii = domainToASCII(host);
  if (!ascii) throw new SsrfBlockedError('无效的目标域名');

  let records: { address: string; family: number }[];
  try {
    records = await dns.lookup(ascii, { all: true, verbatim: true });
  } catch {
    throw new SsrfBlockedError('目标域名 DNS 解析失败');
  }
  if (!records.length) {
    throw new SsrfBlockedError('目标域名未返回可用 IP 地址');
  }

  for (const record of records) {
    if (!allowPrivate && isPrivateOrReservedIp(record.address)) {
      throw new SsrfBlockedError(
        '目标域名解析到了私网、回环、元数据或 Fake-IP 地址，已触发 SSRF 防护拦截',
      );
    }
  }

  const chosen = records.find((rec) => rec.family === 4) ?? records[0];
  return {
    hostname: ascii,
    address: chosen.address,
    family: chosen.family === 6 ? 6 : 4,
  };
}

export interface SafeFetchResult {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

function singleRequest(
  urlObj: URL,
  validated: ValidatedHost,
  userAgent: string,
  timeoutMs: number,
): Promise<{ statusCode: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const isHttps = urlObj.protocol === 'https:';
    const transport = isHttps ? https : http;
    const port = urlObj.port ? Number(urlObj.port) : isHttps ? 443 : 80;

    const req = transport.request(
      {
        host: validated.address,
        port,
        path: `${urlObj.pathname}${urlObj.search}`,
        method: 'GET',
        family: validated.family,
        servername: isHttps && !net.isIP(validated.hostname) ? validated.hostname : undefined,
        headers: {
          Host: urlObj.host,
          'User-Agent': userAgent,
          Accept: '*/*',
          'Accept-Encoding': 'identity',
        },
        timeout: timeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = [];
        let totalBytes = 0;
        res.on('data', (chunk: Buffer) => {
          totalBytes += chunk.length;
          if (totalBytes > MAX_BODY_BYTES) {
            req.destroy();
            reject(new Error('远程订阅响应体超过 5MB 上限'));
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
        res.on('error', reject);
      },
    );

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('拉取远程订阅超时'));
    });
    req.on('error', (err) => {
      reject(new Error(`网络请求失败: ${err.message}`));
    });
    req.end();
  });
}

export async function safeFetchSubscription(
  rawUrl: string,
  options: { allowPrivate: boolean; userAgent?: string | null; timeoutMs?: number },
): Promise<SafeFetchResult> {
  const userAgent = options.userAgent?.trim() || 'clash.meta/1.19.0';
  const timeoutMs = options.timeoutMs ?? FETCH_TIMEOUT_MS;

  let currentUrl: URL;
  try {
    currentUrl = new URL(rawUrl.trim());
  } catch {
    throw new SsrfBlockedError('订阅链接格式无效');
  }

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    if (currentUrl.protocol !== 'http:' && currentUrl.protocol !== 'https:') {
      throw new SsrfBlockedError('仅支持 HTTP / HTTPS 协议订阅链接');
    }
    if (currentUrl.username || currentUrl.password) {
      throw new SsrfBlockedError('订阅链接不允许包含内嵌认证凭据');
    }

    const validated = await validateTargetHost(currentUrl.hostname, options.allowPrivate);
    const res = await singleRequest(currentUrl, validated, userAgent, timeoutMs);

    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
      if (hop === MAX_REDIRECTS) {
        throw new Error('远程订阅重定向次数过多');
      }
      const location = Array.isArray(res.headers.location)
        ? res.headers.location[0]
        : res.headers.location;
      currentUrl = new URL(location, currentUrl);
      continue;
    }

    if (res.statusCode < 200 || res.statusCode >= 300) {
      throw new Error(`远程订阅返回异常状态码 HTTP ${res.statusCode}`);
    }

    const headers: Record<string, string> = {};
    for (const [key, val] of Object.entries(res.headers)) {
      if (val !== undefined) {
        headers[key.toLowerCase()] = Array.isArray(val) ? val.join(', ') : val;
      }
    }

    return { statusCode: res.statusCode, headers, body: res.body };
  }

  throw new Error('远程订阅重定向失败');
}
