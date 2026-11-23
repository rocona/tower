import type { ClientMeta, ClientTarget } from './types.js';

export const CLIENTS: ClientMeta[] = [
  {
    id: 'surge',
    name: 'Surge',
    shortName: 'Surge',
    description: '完整托管配置（#!MANAGED-CONFIG）或仅节点 policy-path',
    supportsModes: ['full', 'nodes'],
    defaultMode: 'full',
    fileExtension: 'conf',
    contentType: 'text/plain; charset=utf-8',
    supportedProtocols: ['ss', 'vmess', 'vless', 'trojan', 'hysteria2', 'tuic', 'wireguard', 'snell', 'anytls'],
    notes: '支持 ShadowTLS v2/v3、Snell、Hy2 证书指纹与端口跳跃、Tailscale 段；跳过 VLESS REALITY / XHTTP / HTTPUpgrade / gRPC。',
  },
  {
    id: 'clash',
    name: 'Clash / mihomo',
    shortName: 'mihomo',
    description: '兼容 Clash Verge / ClashMac / FlClash / Clash Party',
    supportsModes: ['full', 'nodes'],
    defaultMode: 'full',
    fileExtension: 'yaml',
    contentType: 'text/yaml; charset=utf-8',
    supportedProtocols: ['ss', 'vmess', 'vless', 'trojan', 'hysteria2', 'tuic', 'wireguard', 'snell', 'anytls'],
    notes: '支持 VLESS REALITY / Vision / HTTPUpgrade / gRPC、ShadowTLS、Snell v3、AnyTLS、Hy2 端口跳跃；跳过 XHTTP。',
  },
  {
    id: 'stash',
    name: 'Stash',
    shortName: 'Stash',
    description: 'iOS / macOS 规则代理客户端（YAML 格式）',
    supportsModes: ['full', 'nodes'],
    defaultMode: 'full',
    fileExtension: 'yaml',
    contentType: 'text/yaml; charset=utf-8',
    supportedProtocols: ['ss', 'vmess', 'vless', 'trojan', 'hysteria2', 'tuic', 'wireguard', 'snell'],
    notes: '支持主流协议与 Snell v3 / VLESS REALITY；跳过 AnyTLS、XHTTP 与 HTTPUpgrade。',
  },
  {
    id: 'shadowrocket',
    name: 'Shadowrocket',
    shortName: 'Shadowrocket',
    description: 'iOS 订阅（Base64 分享链接）',
    supportsModes: ['nodes'],
    defaultMode: 'nodes',
    fileExtension: 'txt',
    contentType: 'text/plain; charset=utf-8',
    supportedProtocols: ['ss', 'vmess', 'vless', 'trojan', 'hysteria2', 'tuic', 'wireguard', 'snell', 'anytls'],
    notes: '输出标准 Base64 节点列表；支持 SS2022、VLESS REALITY、Hy2、TUIC、AnyTLS 等。',
  },
  {
    id: 'loon',
    name: 'Loon',
    shortName: 'Loon',
    description: 'iOS / tvOS 配置与节点订阅',
    supportsModes: ['full', 'nodes'],
    defaultMode: 'full',
    fileExtension: 'conf',
    contentType: 'text/plain; charset=utf-8',
    supportedProtocols: ['ss', 'vmess', 'vless', 'trojan', 'hysteria2', 'tuic', 'wireguard', 'snell'],
    notes: '支持 ShadowTLS、VLESS REALITY / Vision、Hy2、WireGuard；跳过 AnyTLS 与 XHTTP。',
  },
  {
    id: 'qx',
    name: 'Quantumult X',
    shortName: 'QX',
    description: '节点列表或完整配置（[server_local]）',
    supportsModes: ['full', 'nodes'],
    defaultMode: 'nodes',
    fileExtension: 'conf',
    contentType: 'text/plain; charset=utf-8',
    supportedProtocols: ['ss', 'vmess', 'vless', 'trojan'],
    notes: '严格过滤 QX 不支持的协议（跳过 Hysteria2 / TUIC / WireGuard / Snell / AnyTLS / REALITY / gRPC / XHTTP）。',
  },
  {
    id: 'singbox',
    name: 'sing-box',
    shortName: 'sing-box',
    description: '通用跨平台内核 JSON 配置（含 route / outbounds）',
    supportsModes: ['full', 'nodes'],
    defaultMode: 'full',
    fileExtension: 'json',
    contentType: 'application/json; charset=utf-8',
    supportedProtocols: ['ss', 'vmess', 'vless', 'trojan', 'hysteria2', 'tuic', 'wireguard', 'anytls'],
    notes: '原生 JSON 配置，支持 VLESS REALITY / Vision / HTTPUpgrade / gRPC、Hy2、TUIC、WireGuard、AnyTLS；跳过 Snell 与 XHTTP。',
  },
  {
    id: 'egern',
    name: 'Egern',
    shortName: 'Egern',
    description: 'iOS 现代 YAML 规则代理客户端',
    supportsModes: ['full', 'nodes'],
    defaultMode: 'full',
    fileExtension: 'yaml',
    contentType: 'text/yaml; charset=utf-8',
    supportedProtocols: ['ss', 'vmess', 'vless', 'trojan', 'hysteria2', 'tuic', 'wireguard', 'snell', 'anytls'],
    notes: '输出结构化 YAML 节点与策略组配置；跳过 XHTTP 与 HTTPUpgrade。',
  },
  {
    id: 'v2box',
    name: 'V2Box',
    shortName: 'V2Box',
    description: 'Xray 内核订阅（支持 XHTTP / REALITY / Vision）',
    supportsModes: ['nodes'],
    defaultMode: 'nodes',
    fileExtension: 'txt',
    contentType: 'text/plain; charset=utf-8',
    supportedProtocols: ['ss', 'vmess', 'vless', 'trojan', 'hysteria2', 'tuic', 'wireguard'],
    notes: '支持 VLESS REALITY / Vision / XHTTP / HTTPUpgrade / gRPC 与 Hy2；跳过 Snell、ShadowTLS 与 AnyTLS。',
  },
];

export const CLIENT_MAP: Record<ClientTarget, ClientMeta> = Object.fromEntries(
  CLIENTS.map((client) => [client.id, client]),
) as Record<ClientTarget, ClientMeta>;

export function buildClientImportUrl(
  client: ClientTarget,
  subUrl: string,
  profileName: string,
): string | null {
  const encodedUrl = encodeURIComponent(subUrl);
  const encodedName = encodeURIComponent(profileName);
  switch (client) {
    case 'surge':
      return `surge:///install-config?url=${encodedUrl}`;
    case 'clash':
      return `clash://install-config?url=${encodedUrl}&name=${encodedName}`;
    case 'stash':
      return `stash://install-config?url=${encodedUrl}&name=${encodedName}`;
    case 'shadowrocket':
      return `shadowrocket://add/sub://${btoa(unescape(encodeURIComponent(subUrl))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')}?remark=${encodedName}`;
    case 'loon':
      return `loon://import?nodelist=${encodedUrl}`;
    case 'qx':
      return `quantumult-x:///update-configuration?remote-resource=${encodeURIComponent(JSON.stringify({ server_remote: [`${subUrl}, tag=${profileName}`] }))}`;
    case 'singbox':
      return `sing-box://import-remote-profile?url=${encodedUrl}#${encodedName}`;
    case 'v2box':
      return `v2box://install-sub?url=${encodedUrl}&name=${encodedName}`;
    case 'egern':
    default:
      return null;
  }
}
