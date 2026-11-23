import type { ClientTarget, ProxyNodeConfig } from '../../shared/types.js';

export interface CompatibilityCheck {
  compatible: boolean;
  reason?: string;
}

const SURGE_SS_METHODS = new Set([
  '2022-blake3-aes-128-gcm',
  '2022-blake3-aes-256-gcm',
  'aes-128-gcm',
  'aes-192-gcm',
  'aes-256-gcm',
  'chacha20-ietf-poly1305',
  'xchacha20-ietf-poly1305',
  'rc4',
  'rc4-md5',
  'aes-128-cfb',
  'aes-192-cfb',
  'aes-256-cfb',
  'chacha20-ietf',
  'none',
]);

function isSs2022(method: string | undefined): boolean {
  return Boolean(method && method.toLowerCase().startsWith('2022-'));
}

export function checkNodeCompatibility(
  client: ClientTarget,
  config: ProxyNodeConfig,
): CompatibilityCheck {
  const transport = config.transport?.type ?? 'tcp';
  const hasReality = Boolean(config.reality?.publicKey);
  const hasShadowTls = Boolean(config.shadowTls?.password);

  switch (client) {
    case 'surge': {
      if (hasReality) return { compatible: false, reason: 'Surge 不支持 VLESS REALITY' };
      if (transport === 'xhttp') return { compatible: false, reason: 'Surge 不支持 XHTTP 传输层' };
      if (transport === 'httpupgrade') {
        return { compatible: false, reason: 'Surge 不支持 HTTPUpgrade 传输层' };
      }
      if (transport === 'grpc') return { compatible: false, reason: 'Surge 不支持 gRPC 传输层' };
      if (config.protocol === 'ss' && config.method && !SURGE_SS_METHODS.has(config.method.toLowerCase())) {
        return { compatible: false, reason: `Surge 不支持 SS 加密方式 ${config.method}` };
      }
      if (config.protocol === 'vless' && config.flow && config.flow.includes('vision')) {
        return { compatible: false, reason: 'Surge 不支持 VLESS XTLS Vision 流控' };
      }
      return { compatible: true };
    }

    case 'clash': {
      if (transport === 'xhttp') {
        return { compatible: false, reason: 'Clash / mihomo 不支持 XHTTP 传输层' };
      }
      if (config.protocol === 'snell' && (config.snellVersion ?? 3) > 3) {
        return { compatible: false, reason: 'Clash / mihomo 仅支持 Snell v1-v3' };
      }
      return { compatible: true };
    }

    case 'stash': {
      if (config.protocol === 'anytls') return { compatible: false, reason: 'Stash 暂不支持 AnyTLS' };
      if (transport === 'xhttp') return { compatible: false, reason: 'Stash 不支持 XHTTP 传输层' };
      if (transport === 'httpupgrade') {
        return { compatible: false, reason: 'Stash 不支持 HTTPUpgrade 传输层' };
      }
      if (config.protocol === 'snell' && (config.snellVersion ?? 3) > 3) {
        return { compatible: false, reason: 'Stash 仅支持 Snell v1-v3' };
      }
      return { compatible: true };
    }

    case 'shadowrocket': {
      if (transport === 'xhttp') {
        return { compatible: false, reason: 'Shadowrocket 分享链接暂不支持 XHTTP 无损导出' };
      }
      return { compatible: true };
    }

    case 'loon': {
      if (config.protocol === 'anytls') return { compatible: false, reason: 'Loon 暂不支持 AnyTLS' };
      if (transport === 'xhttp') return { compatible: false, reason: 'Loon 不支持 XHTTP 传输层' };
      if (transport === 'httpupgrade') {
        return { compatible: false, reason: 'Loon 不支持 HTTPUpgrade 传输层' };
      }
      return { compatible: true };
    }

    case 'qx': {
      if (!['ss', 'vmess', 'vless', 'trojan'].includes(config.protocol)) {
        return { compatible: false, reason: `Quantumult X 不支持 ${config.protocol.toUpperCase()} 协议` };
      }
      if (config.protocol === 'ss' && isSs2022(config.method)) {
        return { compatible: false, reason: 'Quantumult X 不支持 Shadowsocks 2022 加密' };
      }
      if (hasShadowTls) return { compatible: false, reason: 'Quantumult X 不支持 ShadowTLS' };
      if (hasReality) return { compatible: false, reason: 'Quantumult X 不支持 VLESS REALITY' };
      if (transport === 'grpc' || transport === 'xhttp' || transport === 'httpupgrade') {
        return { compatible: false, reason: `Quantumult X 不支持 ${transport.toUpperCase()} 传输层` };
      }
      return { compatible: true };
    }

    case 'singbox': {
      if (config.protocol === 'snell') return { compatible: false, reason: 'sing-box 不支持 Snell 协议' };
      if (transport === 'xhttp') return { compatible: false, reason: 'sing-box 不支持 XHTTP 传输层' };
      if (hasShadowTls) {
        return { compatible: false, reason: 'sing-box 需独立 ShadowTLS detour，当前单节点映射跳过' };
      }
      return { compatible: true };
    }

    case 'egern': {
      if (transport === 'xhttp') return { compatible: false, reason: 'Egern 不支持 XHTTP 传输层' };
      if (transport === 'httpupgrade') {
        return { compatible: false, reason: 'Egern 不支持 HTTPUpgrade 传输层' };
      }
      return { compatible: true };
    }

    case 'v2box': {
      if (config.protocol === 'snell') return { compatible: false, reason: 'V2Box (Xray) 不支持 Snell 协议' };
      if (config.protocol === 'anytls') return { compatible: false, reason: 'V2Box (Xray) 不支持 AnyTLS 协议' };
      if (hasShadowTls) return { compatible: false, reason: 'V2Box (Xray) 不支持 ShadowTLS 插件' };
      return { compatible: true };
    }
  }
}
