import { describe, expect, it } from 'vitest';
import { parseSubscriptionPayload } from '../src/server/services/parser.js';
import { detectRegionAndMeta } from '../src/server/services/regionDetector.js';
import { validateTargetHost, isPrivateOrReservedIp, SsrfBlockedError } from '../src/server/security/ssrf.js';

describe('Subscription parser', () => {
  it('parses mixed URIs, preserves original names/slashes, extracts Hy2 pinSHA256 & filters notices', () => {
    const hy2Pin = 'a'.repeat(64);
    const rawLines = [
      'ss://YWVzLTI1Ni1nY206c2VjcmV0@1.2.3.4:8388#%F0%9F%87%AD%F0%9F%87%B0%20%E9%A6%99%E6%B8%AF%20IPLC%200.1x',
      `hysteria2://my-pass@jp.example.com:443?sni=jp.example.com&pinSHA256=${hy2Pin}&mport=20000-30000#%F0%9F%87%AF%F0%9F%87%B5%20%E4%B8%9C%E4%BA%AC/BGP%20Hy2`,
      'vless://11111111-1111-1111-1111-111111111111@us.example.com:443?security=reality&pbk=publickey123&sid=abcd&sni=www.microsoft.com&flow=xtls-rprx-vision#%F0%9F%87%BA%F0%9F%87%B8%20%E7%BE%8E%E5%9B%BD%E5%AE%B6%E5%AE%BD%202x',
      'ss://YWVzLTI1Ni1nY206bm90aWNl@1.1.1.1:80#%E5%89%A9%E4%BD%99%E6%B5%81%E9%87%8F%EF%BC%9A128.5%20GB',
      'ss://YWVzLTI1Ni1nY206bm90aWNl@1.1.1.1:80#%E5%A5%97%E9%A4%90%E5%88%B0%E6%9C%9F%EF%BC%9A2027-01-15',
    ].join('\n');

    const base64Payload = Buffer.from(rawLines, 'utf8').toString('base64');
    const result = parseSubscriptionPayload(base64Payload, {
      filterNotices: true,
      userInfoHeader: 'upload=1073741824; download=2147483648; total=107374182400; expire=1800000000',
    });

    expect(result.nodes).toHaveLength(3);
    expect(result.filteredCount).toBe(2);
    expect(result.userInfo?.total).toBe(107374182400);
    expect(result.userInfo?.expire).toBe(1800000000);

    const hy2 = result.nodes.find((n) => n.protocol === 'hysteria2');
    expect(hy2?.originalName).toBe('🇯🇵 东京/BGP Hy2');
    expect(hy2?.config.certFingerprintSha256).toBe(hy2Pin);
    expect(hy2?.config.portHopping).toBe('20000-30000');

    const vless = result.nodes.find((n) => n.protocol === 'vless');
    expect(vless?.config.reality?.publicKey).toBe('publickey123');
    expect(vless?.config.flow).toBe('xtls-rprx-vision');

    const hkMeta = detectRegionAndMeta(result.nodes[0].originalName);
    expect(hkMeta.region).toBe('HK');
    expect(hkMeta.multiplier).toBe(0.1);

    const usMeta = detectRegionAndMeta(vless!.originalName);
    expect(usMeta.region).toBe('US');
    expect(usMeta.multiplier).toBe(2);
    expect(usMeta.tags).toContain('家宽');
  });

  it('parses Surge [Proxy] lines including Snell with ShadowTLS and Clash YAML', () => {
    const surgeInput = `
[Proxy]
SG-Snell = snell, sg.example.com, 443, psk=secret-psk, version=4, shadow-tls-password=stls-pass, shadow-tls-sni=gateway.icloud.com, shadow-tls-version=3
`;
    const surgeRes = parseSubscriptionPayload(surgeInput, { filterNotices: true });
    expect(surgeRes.nodes).toHaveLength(1);
    expect(surgeRes.nodes[0].protocol).toBe('snell');
    expect(surgeRes.nodes[0].config.snellVersion).toBe(4);
    expect(surgeRes.nodes[0].config.shadowTls?.password).toBe('stls-pass');
    expect(surgeRes.nodes[0].config.shadowTls?.version).toBe(3);

    const clashInput = `
proxies:
  - name: "🇬🇧 伦敦 AnyTLS"
    type: anytls
    server: uk.example.com
    port: 443
    password: anytls-secret
    sni: uk.example.com
`;
    const clashRes = parseSubscriptionPayload(clashInput, { filterNotices: true });
    expect(clashRes.nodes).toHaveLength(1);
    expect(clashRes.nodes[0].protocol).toBe('anytls');
    expect(clashRes.nodes[0].host).toBe('uk.example.com');
  });

  it('blocks private/loopback/Fake-IP URLs for SSRF protection unless explicitly allowed', async () => {
    expect(isPrivateOrReservedIp('127.0.0.1')).toBe(true);
    expect(isPrivateOrReservedIp('192.168.1.10')).toBe(true);
    expect(isPrivateOrReservedIp('198.18.0.1')).toBe(true);
    expect(isPrivateOrReservedIp('1.1.1.1')).toBe(false);

    await expect(validateTargetHost('127.0.0.1', false)).rejects.toThrow(SsrfBlockedError);
    await expect(validateTargetHost('192.168.1.10', false)).rejects.toThrow(SsrfBlockedError);
    await expect(validateTargetHost('198.18.0.1', false)).rejects.toThrow(SsrfBlockedError);
    await expect(validateTargetHost('127.0.0.1', true)).resolves.toBeTruthy();
  });
});
