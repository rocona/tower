export type ProxyProtocol =
  | 'ss'
  | 'vmess'
  | 'vless'
  | 'trojan'
  | 'hysteria2'
  | 'tuic'
  | 'wireguard'
  | 'snell'
  | 'anytls';

export type TransportType = 'tcp' | 'ws' | 'httpupgrade' | 'grpc' | 'xhttp';

export type ClientTarget =
  | 'surge'
  | 'clash'
  | 'stash'
  | 'shadowrocket'
  | 'loon'
  | 'qx'
  | 'singbox'
  | 'egern'
  | 'v2box';

export type ExportMode = 'full' | 'nodes';

export interface ShadowTlsOptions {
  version: 2 | 3;
  password: string;
  sni?: string;
}

export interface RealityOptions {
  publicKey: string;
  shortId?: string;
  fingerprint?: string;
  spiderX?: string;
}

export interface TransportOptions {
  type: TransportType;
  path?: string;
  host?: string;
  headers?: Record<string, string>;
  serviceName?: string;
  authority?: string;
  grpcMode?: 'gun' | 'multi';
  xhttpMode?: 'auto' | 'packet-up' | 'stream-up' | 'stream-one';
}

export interface ProxyNodeConfig {
  protocol: ProxyProtocol;
  host: string;
  port: number;
  password?: string;
  uuid?: string;
  method?: string;
  alterId?: number;
  aead?: boolean;
  psk?: string;
  snellVersion?: number;
  tuicVersion?: 4 | 5;
  token?: string;
  tls?: boolean;
  sni?: string;
  alpn?: string[];
  skipCertVerify?: boolean;
  certFingerprintSha256?: string;
  certVerifyName?: string;
  clientFingerprint?: string;
  reality?: RealityOptions;
  flow?: string;
  transport?: TransportOptions;
  obfs?: string;
  obfsHost?: string;
  obfsPassword?: string;
  shadowTls?: ShadowTlsOptions;
  portHopping?: string;
  portHoppingInterval?: number;
  downMbps?: number;
  upMbps?: number;
  congestionControl?: string;
  udpRelayMode?: string;
  udp?: boolean;
  tfo?: boolean;
  reuse?: boolean;
  wgPrivateKey?: string;
  wgPublicKey?: string;
  wgPresharedKey?: string;
  wgSelfIp?: string;
  wgSelfIpV6?: string;
  wgReserved?: number[];
  wgMtu?: number;
  wgDns?: string[];
  idleSessionCheckInterval?: number;
  idleSessionTimeout?: number;
  minIdleSession?: number;
}

export interface SubscriptionUserInfo {
  upload?: number;
  download?: number;
  total?: number;
  expire?: number;
}

export interface SourceRecord {
  id: string;
  name: string;
  kind: 'subscription' | 'manual';
  url: string | null;
  enabled: boolean;
  userAgent: string | null;
  lastSyncedAt: string | null;
  lastError: string | null;
  nodeCount: number;
  filteredCount: number;
  uploadBytes: number | null;
  downloadBytes: number | null;
  totalBytes: number | null;
  expireAt: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface NodeRecord {
  id: string;
  sourceId: string;
  sourceName?: string;
  fingerprint: string;
  originalName: string;
  customName: string | null;
  protocol: ProxyProtocol;
  host: string;
  port: number;
  config: ProxyNodeConfig;
  detectedRegion: string;
  regionOverride: string | null;
  region: string;
  multiplier: number | null;
  tags: string[];
  blocked: boolean;
  latencyMs: number | null;
  latencyTestedAt: string | null;
  latencyError: string | null;
  createdAt: string;
  updatedAt: string;
}

export type PolicyGroupType = 'select' | 'url-test' | 'fallback' | 'load-balance';

export interface PolicyGroupConfig {
  id: string;
  name: string;
  type: PolicyGroupType;
  includeRegex?: string;
  excludeRegex?: string;
  includeRegions?: string[];
  maxMultiplier?: number | null;
  minMultiplier?: number | null;
  requireResidential?: boolean;
  excludeResidential?: boolean;
  extraPolicies?: string[];
  testUrl?: string;
  interval?: number;
  tolerance?: number;
}

export interface RuleEntry {
  id: string;
  type:
    | 'DOMAIN'
    | 'DOMAIN-SUFFIX'
    | 'DOMAIN-KEYWORD'
    | 'IP-CIDR'
    | 'IP-CIDR6'
    | 'GEOIP'
    | 'FINAL';
  value: string;
  policy: string;
  noResolve?: boolean;
  comment?: string;
  enabled: boolean;
}

export interface TailscaleConfig {
  enabled: boolean;
  sectionName: string;
  subnetCidrs: string[];
  tailnetDomain?: string;
  exitNode?: string;
  policyName: string;
  interactiveLogin: boolean;
  authKey?: string;
}

export interface RoutingProfile {
  id: string;
  name: string;
  preset: 'standard' | 'low-multiplier' | 'residential-isolated';
  testUrl: string;
  testInterval: number;
  groups: PolicyGroupConfig[];
  rules: RuleEntry[];
  tailscale: TailscaleConfig;
  updatedAt: string;
}

export interface ExportChannelRecord {
  id: string;
  name: string;
  client: ClientTarget;
  mode: ExportMode;
  token: string;
  enabled: boolean;
  sourceIds: string[];
  includeRegions: string[];
  excludeBlocked: boolean;
  customFilename: string | null;
  accessCount: number;
  lastAccessedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ExportSkipItem {
  nodeId: string;
  nodeName: string;
  protocol: ProxyProtocol;
  reason: string;
}

export interface ExportCompatibilityReport {
  client: ClientTarget;
  mode: ExportMode;
  totalCandidates: number;
  compatibleCount: number;
  skippedCount: number;
  skipped: ExportSkipItem[];
  skippedByReason: Record<string, number>;
}

export interface ExportPreviewResult {
  content: string;
  contentType: string;
  filename: string;
  masked: boolean;
  report: ExportCompatibilityReport;
}

export interface RegionMeta {
  code: string;
  nameZh: string;
  nameEn: string;
  flag: string;
  x: number;
  y: number;
}

export interface ClientMeta {
  id: ClientTarget;
  name: string;
  shortName: string;
  description: string;
  supportsModes: ExportMode[];
  defaultMode: ExportMode;
  fileExtension: string;
  contentType: string;
  supportedProtocols: ProxyProtocol[];
  notes: string;
}

export interface SecurityStatus {
  authenticated: boolean;
  initialized: boolean;
  adminPasswordExternal: boolean;
  encryptionKeyExternal: boolean;
  allowPrivateFetch: boolean;
  databaseDriver: 'postgres' | 'pglite';
}
