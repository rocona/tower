import { describe, expect, it } from 'vitest';
import { createDefaultRoutingProfile } from '../src/server/db/defaults.js';
import { generateExport } from '../src/server/services/exporter.js';
import type { ClientTarget, NodeRecord } from '../src/shared/types.js';

function makeNode(
  partial: Omit<Partial<NodeRecord>, 'config'> &
    Pick<NodeRecord, 'id' | 'originalName' | 'protocol' | 'host' | 'port'> & {
      config: Omit<NodeRecord['config'], 'protocol' | 'host' | 'port'>;
    },
): NodeRecord {
  const { config, ...rest } = partial;
  return {
    sourceId: 'src-1',
    fingerprint: `fp-${partial.id}`,
    customName: null,
    detectedRegion: 'HK',
    regionOverride: null,
    region: 'HK',
    multiplier: 1,
    tags: [],
    blocked: false,
    latencyMs: null,
    latencyTestedAt: null,
    latencyError: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...rest,
    config: {
      protocol: partial.protocol,
      host: partial.host,
      port: partial.port,
      ...config,
    },
  };
}

const SAMPLE_NODES: NodeRecord[] = [
  makeNode({
    id: 'n1',
    originalName: '🇭🇰 香港 SS',
    protocol: 'ss',
    host: 'hk.example.com',
    port: 8388,
    config: { method: 'aes-256-gcm', password: 'ss-real-password' },
  }),
  makeNode({
    id: 'n2',
    originalName: '🇯🇵 东京 Hy2',
    protocol: 'hysteria2',
    host: 'jp.example.com',
    port: 443,
    region: 'JP',
    detectedRegion: 'JP',
    config: {
      password: 'hy2-real-password',
      sni: 'jp.example.com',
      certFingerprintSha256: 'b'.repeat(64),
      portHopping: '20000-40000',
    },
  }),
  makeNode({
    id: 'n3',
    originalName: '🇸🇬 新加坡 Snell',
    protocol: 'snell',
    host: 'sg.example.com',
    port: 443,
    region: 'SG',
    detectedRegion: 'SG',
    config: {
      psk: 'snell-real-psk',
      snellVersion: 4,
    },
  }),
  makeNode({
    id: 'n4',
    originalName: '🇺🇸 美国 VLESS REALITY',
    protocol: 'vless',
    host: 'us.example.com',
    port: 443,
    region: 'US',
    detectedRegion: 'US',
    config: {
      uuid: '11111111-2222-3333-4444-555555555555',
      tls: true,
      sni: 'www.microsoft.com',
      flow: 'xtls-rprx-vision',
      reality: { publicKey: 'reality-pbk-123', shortId: 'abcd' },
    },
  }),
];

describe('Multi-client exporter & compatibility matrix', () => {
  it('exports Surge with pinSHA256 -> server-cert-fingerprint-sha256, MANAGED-CONFIG, and Tailscale', () => {
    const profile = createDefaultRoutingProfile('standard');
    profile.tailscale.enabled = true;
    profile.tailscale.sectionName = 'Home';
    profile.tailscale.subnetCidrs = ['100.64.0.0/10', '192.168.10.0/24'];

    const res = generateExport({
      client: 'surge',
      mode: 'full',
      nodes: SAMPLE_NODES,
      profile,
      masked: false,
      managedUrl: 'https://tower.example.com/sub/surge/abc123',
    });

    expect(res.content).toContain('#!MANAGED-CONFIG https://tower.example.com/sub/surge/abc123');
    expect(res.content).toContain(`server-cert-fingerprint-sha256=${'b'.repeat(64)}`);
    expect(res.content).toContain('port-hopping=20000-40000');
    expect(res.content).toContain('[Tailscale Home]');
    expect(res.content).toContain('interactive-login = true');
    // Surge does not support VLESS REALITY; should skip n4 strictly
    expect(res.report.skippedCount).toBe(1);
    expect(res.report.compatibleCount).toBe(3);
  });

  it('masks sensitive credentials in preview mode', () => {
    const profile = createDefaultRoutingProfile('standard');
    const masked = generateExport({
      client: 'clash',
      mode: 'full',
      nodes: SAMPLE_NODES,
      profile,
      masked: true,
    });

    expect(masked.content).not.toContain('ss-real-password');
    expect(masked.content).not.toContain('hy2-real-password');
    expect(masked.content).not.toContain('11111111-2222-3333-4444-555555555555');
  });

  it('strictly filters incompatible nodes for Quantumult X and produces valid output for all 9 clients', () => {
    const profile = createDefaultRoutingProfile('standard');
    const qx = generateExport({
      client: 'qx',
      mode: 'nodes',
      nodes: SAMPLE_NODES,
      profile,
      masked: false,
    });
    // QX only supports plain SS from SAMPLE_NODES (skips Hy2, Snell, VLESS REALITY)
    expect(qx.report.compatibleCount).toBe(1);
    expect(qx.report.skippedCount).toBe(3);

    const allClients: ClientTarget[] = [
      'surge',
      'clash',
      'stash',
      'shadowrocket',
      'loon',
      'qx',
      'singbox',
      'egern',
      'v2box',
    ];
    for (const client of allClients) {
      const out = generateExport({
        client,
        mode: client === 'shadowrocket' || client === 'v2box' ? 'nodes' : 'full',
        nodes: SAMPLE_NODES,
        profile,
        masked: false,
      });
      expect(out.content.length).toBeGreaterThan(20);
      expect(out.report.compatibleCount + out.report.skippedCount).toBe(SAMPLE_NODES.length);
    }
  });
});
