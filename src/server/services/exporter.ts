import { stringify as stringifyYaml } from 'yaml';
import { CLIENT_MAP } from '../../shared/clients.js';
import type {
  ClientTarget,
  ExportCompatibilityReport,
  ExportMode,
  ExportPreviewResult,
  ExportSkipItem,
  NodeRecord,
  PolicyGroupConfig,
  ProxyNodeConfig,
  RoutingProfile,
  RuleEntry,
  TailscaleConfig,
} from '../../shared/types.js';
import { checkNodeCompatibility } from './compatibility.js';
import { sanitizeNodeName } from './parserUtils.js';

const MASK = '••••••••';

interface ResolvedNode {
  record: NodeRecord;
  name: string;
  config: ProxyNodeConfig;
}

export interface ExportOptions {
  client: ClientTarget;
  mode: ExportMode;
  nodes: NodeRecord[];
  profile: RoutingProfile;
  masked?: boolean;
  forPreview?: boolean;
  managedUrl?: string;
  filename?: string;
}

function maskNodeConfig(config: ProxyNodeConfig): ProxyNodeConfig {
  return {
    ...config,
    password: config.password ? MASK : undefined,
    uuid: config.uuid ? MASK : undefined,
    psk: config.psk ? MASK : undefined,
    token: config.token ? MASK : undefined,
    obfsPassword: config.obfsPassword ? MASK : undefined,
    wgPrivateKey: config.wgPrivateKey ? MASK : undefined,
    wgPresharedKey: config.wgPresharedKey ? MASK : undefined,
    shadowTls: config.shadowTls
      ? { ...config.shadowTls, password: MASK }
      : undefined,
  };
}

function maskTailscale(ts: TailscaleConfig): TailscaleConfig {
  return {
    ...ts,
    authKey: ts.authKey ? MASK : undefined,
  };
}

function prepareNodes(
  client: ClientTarget,
  nodes: NodeRecord[],
  masked: boolean,
): { resolved: ResolvedNode[]; report: Omit<ExportCompatibilityReport, 'mode'> } {
  const skipped: ExportSkipItem[] = [];
  const skippedByReason: Record<string, number> = {};
  const resolved: ResolvedNode[] = [];
  const usedNames = new Map<string, number>();

  for (const record of nodes) {
    const displayBase = sanitizeNodeName(record.customName || record.originalName) || record.id.slice(0, 8);
    const check = checkNodeCompatibility(client, record.config);
    if (!check.compatible) {
      const reason = check.reason ?? '目标客户端不支持该节点特性';
      skipped.push({
        nodeId: record.id,
        nodeName: displayBase,
        protocol: record.protocol,
        reason,
      });
      skippedByReason[reason] = (skippedByReason[reason] ?? 0) + 1;
      continue;
    }

    const seen = usedNames.get(displayBase) ?? 0;
    usedNames.set(displayBase, seen + 1);
    const uniqueName = seen === 0 ? displayBase : `${displayBase} #${seen + 1}`;
    resolved.push({
      record,
      name: uniqueName,
      config: masked ? maskNodeConfig(record.config) : record.config,
    });
  }

  return {
    resolved,
    report: {
      client,
      totalCandidates: nodes.length,
      compatibleCount: resolved.length,
      skippedCount: skipped.length,
      skipped,
      skippedByReason,
    },
  };
}

function safeRegex(pattern: string | undefined): RegExp | null {
  if (!pattern || !pattern.trim()) return null;
  try {
    return new RegExp(pattern.trim(), 'iu');
  } catch {
    return null;
  }
}

function isResidentialNode(record: NodeRecord): boolean {
  return record.tags.some((tag) => tag === '家宽' || /residential|isp/i.test(tag));
}

interface EvaluatedGroup {
  config: PolicyGroupConfig;
  members: string[];
}

function evaluatePolicyGroups(
  profile: RoutingProfile,
  nodes: ResolvedNode[],
): EvaluatedGroup[] {
  const groupNames = new Set(profile.groups.map((g) => g.name));
  const builtinPolicies = new Set(['DIRECT', 'REJECT', 'REJECT-TINYGIF']);
  if (profile.tailscale.enabled && profile.tailscale.policyName) {
    builtinPolicies.add(profile.tailscale.policyName);
  }

  const rawEvaluated: EvaluatedGroup[] = profile.groups.map((group) => {
    const incRe = safeRegex(group.includeRegex);
    const excRe = safeRegex(group.excludeRegex);
    const hasFilter =
      Boolean(incRe) ||
      Boolean(excRe) ||
      Boolean(group.includeRegions?.length) ||
      (group.maxMultiplier !== undefined && group.maxMultiplier !== null) ||
      (group.minMultiplier !== undefined && group.minMultiplier !== null) ||
      Boolean(group.requireResidential) ||
      Boolean(group.excludeResidential);

    const matchedNodes =
      !hasFilter && group.extraPolicies?.length
        ? []
        : nodes
            .filter((item) => {
              const rec = item.record;
              if (group.includeRegions?.length && !group.includeRegions.includes(rec.region)) {
                return false;
              }
              const mult = rec.multiplier ?? 1;
              if (
                group.maxMultiplier !== undefined &&
                group.maxMultiplier !== null &&
                mult > group.maxMultiplier
              ) {
                return false;
              }
              if (
                group.minMultiplier !== undefined &&
                group.minMultiplier !== null &&
                mult < group.minMultiplier
              ) {
                return false;
              }
              if (group.requireResidential && !isResidentialNode(rec)) {
                return false;
              }
              if (group.excludeResidential && isResidentialNode(rec)) {
                return false;
              }
              if (incRe && !incRe.test(item.name)) {
                return false;
              }
              if (excRe && excRe.test(item.name)) {
                return false;
              }
              return true;
            })
            .map((item) => item.name);

    const extras = (group.extraPolicies ?? []).filter(
      (policy) => policy !== group.name && (groupNames.has(policy) || builtinPolicies.has(policy)),
    );

    const combined = [...new Set([...extras, ...matchedNodes])];
    return { config: group, members: combined };
  });

  const allNodeNames = nodes.map((n) => n.name);
  for (const group of rawEvaluated) {
    if (group.members.length === 0) {
      if (group.config.name === 'Proxy' || group.config.name === 'Auto') {
        group.members = allNodeNames.length ? [...allNodeNames] : ['DIRECT'];
      } else {
        group.members = ['DIRECT'];
      }
    }
  }
  return rawEvaluated;
}

function buildSurgeSectionName(name: string, index: number): string {
  const ascii = name.replace(/[^A-Za-z0-9_-]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
  return ascii ? `wg_${ascii.slice(0, 24)}_${index + 1}` : `wg_node_${index + 1}`;
}

function formatSurgeProxyLine(
  node: ResolvedNode,
  wgSections: string[],
  index: number,
): string {
  const c = node.config;
  const parts: string[] = [];

  const appendCommonTls = () => {
    if (c.sni) parts.push(`sni=${c.sni}`);
    if (c.skipCertVerify) parts.push('skip-cert-verify=true');
    if (c.certFingerprintSha256) {
      parts.push(`server-cert-fingerprint-sha256=${c.certFingerprintSha256}`);
    }
  };

  const appendWs = () => {
    if (c.transport?.type === 'ws') {
      parts.push('ws=true');
      if (c.transport.path) parts.push(`ws-path=${c.transport.path}`);
      const headerPairs: string[] = [];
      if (c.transport.headers) {
        for (const [k, v] of Object.entries(c.transport.headers)) {
          headerPairs.push(`${k}:${v}`);
        }
      } else if (c.transport.host) {
        headerPairs.push(`Host:${c.transport.host}`);
      }
      if (headerPairs.length) {
        parts.push(`ws-headers=${headerPairs.join('|')}`);
      }
    }
  };

  const appendShadowTls = () => {
    if (c.shadowTls) {
      parts.push(`shadow-tls-password=${c.shadowTls.password}`);
      parts.push(`shadow-tls-version=${c.shadowTls.version}`);
      if (c.shadowTls.sni) parts.push(`shadow-tls-sni=${c.shadowTls.sni}`);
    }
  };

  switch (c.protocol) {
    case 'ss': {
      parts.push('ss', c.host, String(c.port));
      if (c.method) parts.push(`encrypt-method=${c.method}`);
      if (c.password) parts.push(`password=${c.password}`);
      if (c.obfs) parts.push(`obfs=${c.obfs}`);
      if (c.obfsHost) parts.push(`obfs-host=${c.obfsHost}`);
      appendShadowTls();
      if (c.udp) parts.push('udp-relay=true');
      if (c.tfo) parts.push('tfo=true');
      break;
    }
    case 'vmess': {
      parts.push('vmess', c.host, String(c.port));
      if (c.uuid) parts.push(`username=${c.uuid}`);
      if (c.method && c.method !== 'auto') parts.push(`encrypt-method=${c.method}`);
      parts.push(`vmess-aead=${c.aead === false ? 'false' : 'true'}`);
      if (c.tls) parts.push('tls=true');
      appendCommonTls();
      appendWs();
      if (c.udp) parts.push('udp-relay=true');
      if (c.tfo) parts.push('tfo=true');
      break;
    }
    case 'vless': {
      parts.push('vless', c.host, String(c.port));
      if (c.uuid) parts.push(`username=${c.uuid}`);
      if (c.tls) parts.push('tls=true');
      appendCommonTls();
      appendWs();
      if (c.udp) parts.push('udp-relay=true');
      if (c.tfo) parts.push('tfo=true');
      break;
    }
    case 'trojan': {
      parts.push('trojan', c.host, String(c.port));
      if (c.password) parts.push(`password=${c.password}`);
      appendCommonTls();
      appendWs();
      if (c.udp) parts.push('udp-relay=true');
      if (c.tfo) parts.push('tfo=true');
      break;
    }
    case 'hysteria2': {
      parts.push('hysteria2', c.host, String(c.port));
      if (c.password) parts.push(`password=${c.password}`);
      if (c.downMbps) parts.push(`download-bandwidth=${c.downMbps}`);
      if (c.upMbps) parts.push(`upload-bandwidth=${c.upMbps}`);
      if (c.portHopping) parts.push(`port-hopping=${c.portHopping}`);
      if (c.portHoppingInterval) parts.push(`port-hopping-interval=${c.portHoppingInterval}`);
      if (c.obfs) parts.push(`obfs=${c.obfs}`);
      if (c.obfsPassword) parts.push(`obfs-password=${c.obfsPassword}`);
      appendCommonTls();
      break;
    }
    case 'tuic': {
      const isV5 = c.tuicVersion === 5 || Boolean(c.uuid);
      parts.push(isV5 ? 'tuic-v5' : 'tuic', c.host, String(c.port));
      if (isV5) {
        if (c.uuid) parts.push(`uuid=${c.uuid}`);
        if (c.password) parts.push(`password=${c.password}`);
      } else if (c.token) {
        parts.push(`token=${c.token}`);
      }
      if (c.alpn?.length) parts.push(`alpn=${c.alpn.join(',')}`);
      if (c.congestionControl) parts.push(`congestion-controller=${c.congestionControl}`);
      if (c.udpRelayMode) parts.push(`udp-relay-mode=${c.udpRelayMode}`);
      appendCommonTls();
      break;
    }
    case 'snell': {
      parts.push('snell', c.host, String(c.port));
      if (c.psk) parts.push(`psk=${c.psk}`);
      parts.push(`version=${c.snellVersion ?? 4}`);
      if (c.obfs) parts.push(`obfs=${c.obfs}`);
      if (c.obfsHost) parts.push(`obfs-host=${c.obfsHost}`);
      appendShadowTls();
      if (c.reuse !== undefined) parts.push(`reuse=${c.reuse ? 'true' : 'false'}`);
      if (c.tfo) parts.push('tfo=true');
      break;
    }
    case 'anytls': {
      parts.push('anytls', c.host, String(c.port));
      if (c.password) parts.push(`password=${c.password}`);
      if (c.alpn?.length) parts.push(`alpn=${c.alpn.join(',')}`);
      appendCommonTls();
      if (c.reuse !== undefined) parts.push(`reuse=${c.reuse ? 'true' : 'false'}`);
      if (c.tfo) parts.push('tfo=true');
      break;
    }
    case 'wireguard': {
      const sectionName = buildSurgeSectionName(node.name, index);
      parts.push('wireguard', `section-name=${sectionName}`);
      const peerParts: string[] = [];
      if (c.wgPublicKey) peerParts.push(`public-key = ${c.wgPublicKey}`);
      peerParts.push(`endpoint = ${c.host.includes(':') ? `[${c.host}]` : c.host}:${c.port}`);
      peerParts.push('allowed-ips = "0.0.0.0/0, ::/0"');
      if (c.wgPresharedKey) peerParts.push(`preshared-key = ${c.wgPresharedKey}`);
      if (c.wgReserved?.length) peerParts.push(`client-id = ${c.wgReserved.join('/')}`);

      const secLines = [`[WireGuard ${sectionName}]`];
      if (c.wgPrivateKey) secLines.push(`private-key = ${c.wgPrivateKey}`);
      if (c.wgSelfIp) secLines.push(`self-ip = ${c.wgSelfIp}`);
      if (c.wgSelfIpV6) secLines.push(`self-ip-v6 = ${c.wgSelfIpV6}`);
      if (c.wgDns?.length) secLines.push(`dns-server = ${c.wgDns.join(', ')}`);
      if (c.wgMtu) secLines.push(`mtu = ${c.wgMtu}`);
      secLines.push(`peer = (${peerParts.join(', ')})`);
      wgSections.push(secLines.join('\n'));
      break;
    }
  }

  return `${node.name} = ${parts.join(', ')}`;
}

function formatRuleLine(rule: RuleEntry): string {
  if (rule.type === 'FINAL') {
    return `FINAL,${rule.policy},dns-failed`;
  }
  const noResolve =
    rule.noResolve && (rule.type === 'IP-CIDR' || rule.type === 'IP-CIDR6' || rule.type === 'GEOIP')
      ? ',no-resolve'
      : '';
  return `${rule.type},${rule.value},${rule.policy}${noResolve}`;
}

function exportSurge(
  nodes: ResolvedNode[],
  profile: RoutingProfile,
  mode: ExportMode,
  masked: boolean,
  managedUrl?: string,
): string {
  const wgSections: string[] = [];
  const proxyLines = nodes.map((node, index) => formatSurgeProxyLine(node, wgSections, index));

  if (mode === 'nodes') {
    const blocks: string[] = [];
    if (proxyLines.length) blocks.push(proxyLines.join('\n'));
    if (wgSections.length) blocks.push(wgSections.join('\n\n'));
    return blocks.join('\n\n') + '\n';
  }

  const ts = masked ? maskTailscale(profile.tailscale) : profile.tailscale;
  const groups = evaluatePolicyGroups(profile, nodes);
  const out: string[] = [];

  if (managedUrl) {
    out.push(`#!MANAGED-CONFIG ${managedUrl} interval=86400 strict=false`);
    out.push('');
  }

  out.push(
    '[General]',
    'loglevel = notify',
    'dns-server = 223.5.5.5, 119.29.29.29, system',
    'doh-server = https://dns.alidns.com/dns-query',
    'skip-proxy = 127.0.0.1, 192.168.0.0/16, 10.0.0.0/8, 172.16.0.0/12, 100.64.0.0/10, localhost, *.local',
    `internet-test-url = ${profile.testUrl}`,
    `proxy-test-url = ${profile.testUrl}`,
    'test-timeout = 5',
    'ipv6 = false',
    '',
  );

  out.push('[Proxy]');
  if (ts.enabled) {
    out.push(`${ts.policyName} = tailscale, section-name=${ts.sectionName}`);
  }
  out.push(...proxyLines);
  out.push('');

  if (wgSections.length) {
    out.push(wgSections.join('\n\n'), '');
  }

  if (ts.enabled) {
    out.push(`[Tailscale ${ts.sectionName}]`);
    out.push(`interactive-login = ${ts.interactiveLogin ? 'true' : 'false'}`);
    if (!ts.interactiveLogin && ts.authKey) {
      out.push(`auth-key = ${ts.authKey}`);
    }
    if (ts.exitNode) {
      out.push(`exit-node = ${ts.exitNode}`);
    }
    out.push('');
  }

  out.push('[Proxy Group]');
  for (const group of groups) {
    const g = group.config;
    if (g.type === 'select') {
      out.push(`${g.name} = select, ${group.members.join(', ')}`);
    } else if (g.type === 'url-test') {
      out.push(
        `${g.name} = url-test, ${group.members.join(', ')}, url=${g.testUrl || profile.testUrl}, interval=${g.interval || profile.testInterval}, tolerance=${g.tolerance ?? 60}`,
      );
    } else if (g.type === 'fallback') {
      out.push(
        `${g.name} = fallback, ${group.members.join(', ')}, url=${g.testUrl || profile.testUrl}, interval=${g.interval || profile.testInterval}`,
      );
    } else {
      out.push(
        `${g.name} = load-balance, ${group.members.join(', ')}, url=${g.testUrl || profile.testUrl}, interval=${g.interval || profile.testInterval}`,
      );
    }
  }
  out.push('');

  out.push('[Rule]');
  if (ts.enabled) {
    for (const cidr of ts.subnetCidrs) {
      if (cidr.trim()) {
        out.push(`IP-CIDR,${cidr.trim()},${ts.policyName},no-resolve`);
      }
    }
    if (ts.tailnetDomain?.trim()) {
      out.push(`DOMAIN-SUFFIX,${ts.tailnetDomain.trim()},${ts.policyName}`);
    }
  }
  for (const rule of profile.rules) {
    if (!rule.enabled) continue;
    out.push(formatRuleLine(rule));
  }
  out.push('');

  return out.join('\n');
}

function buildClashProxyObject(node: ResolvedNode): Record<string, unknown> {
  const c = node.config;
  const base: Record<string, unknown> = {
    name: node.name,
    type: c.protocol,
    server: c.host,
    port: c.port,
  };

  const attachTransport = (obj: Record<string, unknown>) => {
    if (!c.transport || c.transport.type === 'tcp') return;
    obj.network = c.transport.type;
    if (c.transport.type === 'ws') {
      const wsOpts: Record<string, unknown> = { path: c.transport.path || '/' };
      if (c.transport.headers && Object.keys(c.transport.headers).length) {
        wsOpts.headers = c.transport.headers;
      } else if (c.transport.host) {
        wsOpts.headers = { Host: c.transport.host };
      }
      obj['ws-opts'] = wsOpts;
    } else if (c.transport.type === 'httpupgrade') {
      const opts: Record<string, unknown> = { path: c.transport.path || '/' };
      if (c.transport.host) opts.host = c.transport.host;
      obj['httpupgrade-opts'] = opts;
    } else if (c.transport.type === 'grpc') {
      obj['grpc-opts'] = { 'grpc-service-name': c.transport.serviceName || '' };
    }
  };

  const attachTls = (obj: Record<string, unknown>, includeTlsFlag = false) => {
    if (includeTlsFlag && c.tls) obj.tls = true;
    if (c.sni) obj.sni = c.sni;
    if (c.alpn?.length) obj.alpn = c.alpn;
    if (c.skipCertVerify) obj['skip-cert-verify'] = true;
    if (c.certFingerprintSha256) obj.fingerprint = c.certFingerprintSha256;
    if (c.clientFingerprint) obj['client-fingerprint'] = c.clientFingerprint;
  };

  switch (c.protocol) {
    case 'ss': {
      base.cipher = c.method;
      base.password = c.password;
      if (c.udp !== undefined) base.udp = c.udp;
      if (c.tfo) base.tfo = true;
      if (c.shadowTls) {
        base.plugin = 'shadow-tls';
        base['plugin-opts'] = {
          host: c.shadowTls.sni || c.host,
          password: c.shadowTls.password,
          version: c.shadowTls.version,
        };
      } else if (c.obfs) {
        base.plugin = 'obfs';
        base['plugin-opts'] = {
          mode: c.obfs,
          ...(c.obfsHost ? { host: c.obfsHost } : {}),
        };
      }
      return base;
    }
    case 'vmess': {
      base.uuid = c.uuid;
      base.alterId = c.alterId ?? 0;
      base.cipher = c.method || 'auto';
      base.udp = c.udp ?? true;
      if (c.tls) base.tls = true;
      if (c.sni) base.servername = c.sni;
      if (c.skipCertVerify) base['skip-cert-verify'] = true;
      if (c.certFingerprintSha256) base.fingerprint = c.certFingerprintSha256;
      if (c.clientFingerprint) base['client-fingerprint'] = c.clientFingerprint;
      attachTransport(base);
      return base;
    }
    case 'vless': {
      base.uuid = c.uuid;
      base.udp = c.udp ?? true;
      if (c.flow) base.flow = c.flow;
      if (c.tls || c.reality) base.tls = true;
      if (c.sni) base.servername = c.sni;
      if (c.alpn?.length) base.alpn = c.alpn;
      if (c.skipCertVerify) base['skip-cert-verify'] = true;
      if (c.certFingerprintSha256) base.fingerprint = c.certFingerprintSha256;
      if (c.clientFingerprint || c.reality?.fingerprint) {
        base['client-fingerprint'] = c.clientFingerprint || c.reality?.fingerprint;
      }
      if (c.reality) {
        base['reality-opts'] = {
          'public-key': c.reality.publicKey,
          ...(c.reality.shortId ? { 'short-id': c.reality.shortId } : {}),
        };
      }
      attachTransport(base);
      return base;
    }
    case 'trojan': {
      base.password = c.password;
      base.udp = c.udp ?? true;
      attachTls(base, false);
      attachTransport(base);
      return base;
    }
    case 'hysteria2': {
      base.password = c.password;
      if (c.portHopping) base.ports = c.portHopping;
      if (c.portHoppingInterval) base['hop-interval'] = c.portHoppingInterval;
      if (c.downMbps) base.down = `${c.downMbps} Mbps`;
      if (c.upMbps) base.up = `${c.upMbps} Mbps`;
      if (c.obfs) base.obfs = c.obfs;
      if (c.obfsPassword) base['obfs-password'] = c.obfsPassword;
      attachTls(base, false);
      return base;
    }
    case 'tuic': {
      if (c.tuicVersion === 5 || c.uuid) {
        base.uuid = c.uuid;
        if (c.password) base.password = c.password;
      } else {
        base.token = c.token;
      }
      if (c.congestionControl) base['congestion-controller'] = c.congestionControl;
      if (c.udpRelayMode) base['udp-relay-mode'] = c.udpRelayMode;
      attachTls(base, false);
      return base;
    }
    case 'wireguard': {
      base['private-key'] = c.wgPrivateKey;
      base['public-key'] = c.wgPublicKey;
      if (c.wgPresharedKey) base['pre-shared-key'] = c.wgPresharedKey;
      if (c.wgSelfIp) base.ip = c.wgSelfIp;
      if (c.wgSelfIpV6) base.ipv6 = c.wgSelfIpV6;
      if (c.wgReserved?.length) base.reserved = c.wgReserved;
      if (c.wgMtu) base.mtu = c.wgMtu;
      if (c.wgDns?.length) base.dns = c.wgDns;
      base.udp = true;
      return base;
    }
    case 'snell': {
      base.psk = c.psk;
      base.version = Math.min(c.snellVersion ?? 3, 3);
      if (c.obfs) {
        base['obfs-opts'] = {
          mode: c.obfs,
          ...(c.obfsHost ? { host: c.obfsHost } : {}),
        };
      }
      if (c.shadowTls) {
        base.plugin = 'shadow-tls';
        base['plugin-opts'] = {
          host: c.shadowTls.sni || c.host,
          password: c.shadowTls.password,
          version: c.shadowTls.version,
        };
      }
      return base;
    }
    case 'anytls': {
      base.password = c.password;
      base.udp = c.udp ?? true;
      attachTls(base, false);
      if (c.idleSessionCheckInterval) {
        base['idle-session-check-interval'] = c.idleSessionCheckInterval;
      }
      if (c.idleSessionTimeout) base['idle-session-timeout'] = c.idleSessionTimeout;
      if (c.minIdleSession) base['min-idle-session'] = c.minIdleSession;
      return base;
    }
  }
}

function exportClashOrStash(
  client: 'clash' | 'stash',
  nodes: ResolvedNode[],
  profile: RoutingProfile,
  mode: ExportMode,
): string {
  const proxies = nodes.map((n) => buildClashProxyObject(n));
  if (mode === 'nodes') {
    return stringifyYaml({ proxies });
  }

  const groups = evaluatePolicyGroups(profile, nodes);
  const proxyGroups = groups.map((group) => {
    const g = group.config;
    const obj: Record<string, unknown> = {
      name: g.name,
      type: g.type,
      proxies: group.members,
    };
    if (g.type !== 'select') {
      obj.url = g.testUrl || profile.testUrl;
      obj.interval = g.interval || profile.testInterval;
      if (g.type === 'url-test' && g.tolerance) obj.tolerance = g.tolerance;
    }
    return obj;
  });

  const rules: string[] = [];
  if (profile.tailscale.enabled) {
    for (const cidr of profile.tailscale.subnetCidrs) {
      if (cidr.trim()) rules.push(`IP-CIDR,${cidr.trim()},DIRECT,no-resolve`);
    }
    if (profile.tailscale.tailnetDomain?.trim()) {
      rules.push(`DOMAIN-SUFFIX,${profile.tailscale.tailnetDomain.trim()},DIRECT`);
    }
  }
  for (const rule of profile.rules) {
    if (!rule.enabled) continue;
    if (rule.type === 'FINAL') {
      rules.push(`MATCH,${rule.policy}`);
    } else {
      rules.push(formatRuleLine(rule));
    }
  }

  const fakeIpFilter = ['*.lan', '*.local', 'localhost.ptlogin2.qq.com'];
  if (profile.tailscale.enabled) {
    fakeIpFilter.push('*.ts.net');
    if (profile.tailscale.tailnetDomain?.trim()) {
      fakeIpFilter.push(`*.${profile.tailscale.tailnetDomain.trim().replace(/^\*\./, '')}`);
    }
  }

  const doc: Record<string, unknown> = {
    'mixed-port': 7890,
    'allow-lan': false,
    mode: 'rule',
    'log-level': 'info',
    ipv6: false,
    dns: {
      enable: true,
      'enhanced-mode': 'fake-ip',
      'fake-ip-range': '198.18.0.1/16',
      'fake-ip-filter': fakeIpFilter,
      nameserver: ['https://dns.alidns.com/dns-query', 'https://doh.pub/dns-query'],
    },
    proxies,
    'proxy-groups': proxyGroups,
    rules,
  };

  if (client === 'clash') {
    doc['unified-delay'] = true;
    doc['tcp-concurrent'] = true;
  }

  return stringifyYaml(doc);
}

function buildSingboxOutbound(node: ResolvedNode): Record<string, unknown> {
  const c = node.config;
  const buildTls = (force = false): Record<string, unknown> | undefined => {
    if (!force && !c.tls && !c.reality) return undefined;
    const tls: Record<string, unknown> = {
      enabled: true,
      server_name: c.sni || c.host,
    };
    if (c.skipCertVerify) tls.insecure = true;
    if (c.alpn?.length) tls.alpn = c.alpn;
    if (c.clientFingerprint || c.reality?.fingerprint) {
      tls.utls = { enabled: true, fingerprint: c.clientFingerprint || c.reality?.fingerprint };
    }
    if (c.reality) {
      tls.reality = {
        enabled: true,
        public_key: c.reality.publicKey,
        ...(c.reality.shortId ? { short_id: c.reality.shortId } : {}),
      };
    }
    return tls;
  };

  const buildTransport = (): Record<string, unknown> | undefined => {
    if (!c.transport || c.transport.type === 'tcp') return undefined;
    if (c.transport.type === 'ws') {
      return {
        type: 'ws',
        path: c.transport.path || '/',
        ...(c.transport.headers
          ? { headers: c.transport.headers }
          : c.transport.host
            ? { headers: { Host: c.transport.host } }
            : {}),
      };
    }
    if (c.transport.type === 'httpupgrade') {
      return {
        type: 'httpupgrade',
        path: c.transport.path || '/',
        ...(c.transport.host ? { host: c.transport.host } : {}),
      };
    }
    if (c.transport.type === 'grpc') {
      return {
        type: 'grpc',
        service_name: c.transport.serviceName || '',
      };
    }
    return undefined;
  };

  switch (c.protocol) {
    case 'ss':
      return {
        type: 'shadowsocks',
        tag: node.name,
        server: c.host,
        server_port: c.port,
        method: c.method,
        password: c.password,
      };
    case 'vmess':
      return {
        type: 'vmess',
        tag: node.name,
        server: c.host,
        server_port: c.port,
        uuid: c.uuid,
        security: c.method || 'auto',
        alter_id: c.alterId ?? 0,
        ...(buildTls(false) ? { tls: buildTls(false) } : {}),
        ...(buildTransport() ? { transport: buildTransport() } : {}),
      };
    case 'vless':
      return {
        type: 'vless',
        tag: node.name,
        server: c.host,
        server_port: c.port,
        uuid: c.uuid,
        ...(c.flow ? { flow: c.flow } : {}),
        ...(buildTls(false) ? { tls: buildTls(false) } : {}),
        ...(buildTransport() ? { transport: buildTransport() } : {}),
      };
    case 'trojan':
      return {
        type: 'trojan',
        tag: node.name,
        server: c.host,
        server_port: c.port,
        password: c.password,
        tls: buildTls(true),
        ...(buildTransport() ? { transport: buildTransport() } : {}),
      };
    case 'hysteria2':
      return {
        type: 'hysteria2',
        tag: node.name,
        server: c.host,
        server_port: c.port,
        password: c.password,
        ...(c.portHopping ? { server_ports: [c.portHopping.replace('-', ':')] } : {}),
        ...(c.portHoppingInterval ? { hop_interval: `${c.portHoppingInterval}s` } : {}),
        ...(c.upMbps ? { up_mbps: c.upMbps } : {}),
        ...(c.downMbps ? { down_mbps: c.downMbps } : {}),
        ...(c.obfs ? { obfs: { type: c.obfs, password: c.obfsPassword || '' } } : {}),
        tls: buildTls(true),
      };
    case 'tuic':
      return {
        type: 'tuic',
        tag: node.name,
        server: c.host,
        server_port: c.port,
        uuid: c.uuid,
        password: c.password,
        ...(c.congestionControl ? { congestion_control: c.congestionControl } : {}),
        ...(c.udpRelayMode ? { udp_relay_mode: c.udpRelayMode } : {}),
        tls: buildTls(true),
      };
    case 'wireguard':
      return {
        type: 'wireguard',
        tag: node.name,
        server: c.host,
        server_port: c.port,
        local_address: [c.wgSelfIp || '172.16.0.2/32', ...(c.wgSelfIpV6 ? [c.wgSelfIpV6] : [])],
        private_key: c.wgPrivateKey,
        peer_public_key: c.wgPublicKey,
        ...(c.wgPresharedKey ? { pre_shared_key: c.wgPresharedKey } : {}),
        ...(c.wgReserved?.length ? { reserved: c.wgReserved } : {}),
        ...(c.wgMtu ? { mtu: c.wgMtu } : {}),
      };
    case 'anytls':
      return {
        type: 'anytls',
        tag: node.name,
        server: c.host,
        server_port: c.port,
        password: c.password,
        ...(c.idleSessionCheckInterval
          ? { idle_session_check_interval: `${c.idleSessionCheckInterval}s` }
          : {}),
        ...(c.idleSessionTimeout ? { idle_session_timeout: `${c.idleSessionTimeout}s` } : {}),
        ...(c.minIdleSession ? { min_idle_session: c.minIdleSession } : {}),
        tls: buildTls(true),
      };
    case 'snell':
      return { type: 'direct', tag: node.name };
  }
}

function exportSingbox(
  nodes: ResolvedNode[],
  profile: RoutingProfile,
  mode: ExportMode,
  masked: boolean,
): string {
  const nodeOutbounds = nodes.map((n) => buildSingboxOutbound(n));
  if (mode === 'nodes') {
    return JSON.stringify({ outbounds: nodeOutbounds }, null, 2) + '\n';
  }

  const ts = masked ? maskTailscale(profile.tailscale) : profile.tailscale;
  const groups = evaluatePolicyGroups(profile, nodes);
  const mapPolicyTag = (policy: string): string => {
    if (policy === 'DIRECT') return 'direct';
    if (policy === 'REJECT' || policy === 'REJECT-TINYGIF') return 'block';
    return policy;
  };

  const groupOutbounds = groups.map((group) => {
    const g = group.config;
    const mappedMembers = group.members.map(mapPolicyTag);
    if (g.type === 'select') {
      return {
        type: 'selector',
        tag: g.name,
        outbounds: mappedMembers,
      };
    }
    return {
      type: 'urltest',
      tag: g.name,
      outbounds: mappedMembers,
      url: g.testUrl || profile.testUrl,
      interval: `${g.interval || profile.testInterval}s`,
      tolerance: g.tolerance ?? 60,
    };
  });

  const routeRules: Record<string, unknown>[] = [
    { protocol: 'dns', action: 'hijack-dns' },
    { ip_is_private: true, outbound: 'direct' },
  ];
  if (ts.enabled) {
    const cidrs = ts.subnetCidrs.map((s) => s.trim()).filter(Boolean);
    if (cidrs.length) {
      routeRules.push({ ip_cidr: cidrs, outbound: ts.policyName });
    }
    if (ts.tailnetDomain?.trim()) {
      routeRules.push({ domain_suffix: [ts.tailnetDomain.trim()], outbound: ts.policyName });
    }
  }

  let finalOutbound = 'Proxy';
  for (const rule of profile.rules) {
    if (!rule.enabled) continue;
    const target = mapPolicyTag(rule.policy);
    if (rule.type === 'FINAL') {
      finalOutbound = target;
    } else if (rule.type === 'DOMAIN') {
      routeRules.push({ domain: [rule.value], outbound: target });
    } else if (rule.type === 'DOMAIN-SUFFIX') {
      routeRules.push({ domain_suffix: [rule.value], outbound: target });
    } else if (rule.type === 'DOMAIN-KEYWORD') {
      routeRules.push({ domain_keyword: [rule.value], outbound: target });
    } else if (rule.type === 'IP-CIDR' || rule.type === 'IP-CIDR6') {
      routeRules.push({ ip_cidr: [rule.value], outbound: target });
    } else if (rule.type === 'GEOIP') {
      routeRules.push({ rule_set: [`geoip-${rule.value.toLowerCase()}`], outbound: target });
    }
  }

  const doc: Record<string, unknown> = {
    log: { level: 'info', timestamp: true },
    dns: {
      servers: [
        { tag: 'dns-direct', address: 'https://dns.alidns.com/dns-query', detour: 'direct' },
        { tag: 'dns-remote', address: 'https://1.1.1.1/dns-query', detour: finalOutbound },
      ],
      final: 'dns-remote',
    },
    inbounds: [
      {
        type: 'mixed',
        tag: 'mixed-in',
        listen: '127.0.0.1',
        listen_port: 7890,
      },
    ],
    outbounds: [
      ...groupOutbounds,
      ...nodeOutbounds,
      { type: 'direct', tag: 'direct' },
      { type: 'block', tag: 'block' },
    ],
    route: {
      rules: routeRules,
      final: finalOutbound,
      auto_detect_interface: true,
    },
  };

  if (ts.enabled) {
    doc.endpoints = [
      {
        type: 'tailscale',
        tag: ts.policyName,
        hostname: ts.sectionName,
        ...(ts.authKey ? { auth_key: ts.authKey } : {}),
        ...(ts.exitNode ? { exit_node: ts.exitNode } : {}),
        accept_routes: true,
      },
    ];
  }

  return JSON.stringify(doc, null, 2) + '\n';
}

function formatLoonProxyLine(node: ResolvedNode): string {
  const c = node.config;
  const parts: string[] = [];
  switch (c.protocol) {
    case 'ss': {
      parts.push('Shadowsocks', c.host, String(c.port), c.method || 'aes-128-gcm', `"${c.password || ''}"`);
      if (c.obfs) parts.push(`obfs-name=${c.obfs}`);
      if (c.obfsHost) parts.push(`obfs-host=${c.obfsHost}`);
      if (c.shadowTls) {
        parts.push(`shadow-tls-password=${c.shadowTls.password}`);
        parts.push(`shadow-tls-version=${c.shadowTls.version}`);
        if (c.shadowTls.sni) parts.push(`shadow-tls-sni=${c.shadowTls.sni}`);
      }
      if (c.udp) parts.push('udp=true');
      break;
    }
    case 'vmess': {
      parts.push('vmess', c.host, String(c.port), c.method || 'auto', `"${c.uuid || ''}"`);
      parts.push(`transport=${c.transport?.type || 'tcp'}`);
      if (c.transport?.path) parts.push(`path=${c.transport.path}`);
      if (c.transport?.host) parts.push(`host=${c.transport.host}`);
      if (c.tls) parts.push('over-tls=true');
      if (c.sni) parts.push(`tls-name=${c.sni}`);
      if (c.skipCertVerify) parts.push('skip-cert-verify=true');
      break;
    }
    case 'vless': {
      parts.push('VLESS', c.host, String(c.port), `"${c.uuid || ''}"`);
      parts.push(`transport=${c.transport?.type || 'tcp'}`);
      if (c.transport?.path) parts.push(`path=${c.transport.path}`);
      if (c.transport?.host) parts.push(`host=${c.transport.host}`);
      if (c.flow) parts.push(`flow=${c.flow}`);
      if (c.tls || c.reality) parts.push('over-tls=true');
      if (c.sni) parts.push(`sni=${c.sni}`);
      if (c.reality) {
        parts.push(`public-key="${c.reality.publicKey}"`);
        if (c.reality.shortId) parts.push(`short-id=${c.reality.shortId}`);
      }
      if (c.skipCertVerify) parts.push('skip-cert-verify=true');
      break;
    }
    case 'trojan': {
      parts.push('trojan', c.host, String(c.port), `"${c.password || ''}"`);
      if (c.sni) parts.push(`tls-name=${c.sni}`);
      if (c.skipCertVerify) parts.push('skip-cert-verify=true');
      if (c.transport?.type === 'ws') {
        parts.push('transport=ws');
        if (c.transport.path) parts.push(`path=${c.transport.path}`);
        if (c.transport.host) parts.push(`host=${c.transport.host}`);
      }
      break;
    }
    case 'hysteria2': {
      parts.push('Hysteria2', c.host, String(c.port), `"${c.password || ''}"`);
      if (c.sni) parts.push(`sni=${c.sni}`);
      if (c.skipCertVerify) parts.push('skip-cert-verify=true');
      if (c.certFingerprintSha256) {
        parts.push(`server-cert-fingerprint-sha256=${c.certFingerprintSha256}`);
      }
      if (c.portHopping) parts.push(`port-hopping=${c.portHopping}`);
      if (c.downMbps) parts.push(`download-bandwidth=${c.downMbps}`);
      break;
    }
    case 'tuic': {
      parts.push('TUIC', c.host, String(c.port));
      if (c.uuid) parts.push(`uuid=${c.uuid}`);
      if (c.password) parts.push(`password="${c.password}"`);
      if (c.token) parts.push(`token="${c.token}"`);
      if (c.sni) parts.push(`sni=${c.sni}`);
      if (c.skipCertVerify) parts.push('skip-cert-verify=true');
      break;
    }
    case 'snell': {
      parts.push('snell', c.host, String(c.port), `psk="${c.psk || ''}"`, `version=${c.snellVersion ?? 4}`);
      if (c.shadowTls) {
        parts.push(`shadow-tls-password=${c.shadowTls.password}`);
        parts.push(`shadow-tls-version=${c.shadowTls.version}`);
        if (c.shadowTls.sni) parts.push(`shadow-tls-sni=${c.shadowTls.sni}`);
      }
      break;
    }
    case 'wireguard': {
      parts.push(
        'wireguard',
        `interface-ip=${c.wgSelfIp || '172.16.0.2'}`,
        `private-key="${c.wgPrivateKey || ''}"`,
        `peers=[{public-key="${c.wgPublicKey || ''}", allowed-ips="0.0.0.0/0", endpoint=${c.host}:${c.port}}]`,
      );
      break;
    }
    default:
      return '';
  }
  return `${node.name} = ${parts.join(', ')}`;
}

function exportLoon(nodes: ResolvedNode[], profile: RoutingProfile, mode: ExportMode): string {
  const proxyLines = nodes.map(formatLoonProxyLine).filter(Boolean);
  if (mode === 'nodes') {
    return proxyLines.join('\n') + '\n';
  }
  const groups = evaluatePolicyGroups(profile, nodes);
  const out: string[] = [
    '[General]',
    'dns-server = 223.5.5.5, 119.29.29.29, system',
    `proxy-test-url = ${profile.testUrl}`,
    '',
    '[Proxy]',
    ...proxyLines,
    '',
    '[Proxy Group]',
  ];
  for (const group of groups) {
    const g = group.config;
    if (g.type === 'select') {
      out.push(`${g.name} = select, ${group.members.join(', ')}`);
    } else {
      out.push(
        `${g.name} = url-test, ${group.members.join(', ')}, url=${g.testUrl || profile.testUrl}, interval=${g.interval || profile.testInterval}, tolerance=${g.tolerance ?? 60}`,
      );
    }
  }
  out.push('', '[Rule]');
  for (const rule of profile.rules) {
    if (!rule.enabled) continue;
    out.push(rule.type === 'FINAL' ? `FINAL,${rule.policy}` : formatRuleLine(rule));
  }
  out.push('');
  return out.join('\n');
}

function formatQxLine(node: ResolvedNode): string {
  const c = node.config;
  if (c.protocol === 'ss') {
    const parts = [
      `shadowsocks=${c.host}:${c.port}`,
      `method=${c.method}`,
      `password=${c.password}`,
    ];
    if (c.obfs) parts.push(`obfs=${c.obfs}`);
    if (c.obfsHost) parts.push(`obfs-host=${c.obfsHost}`);
    if (c.udp) parts.push('udp-relay=true');
    parts.push(`tag=${node.name}`);
    return parts.join(', ');
  }
  if (c.protocol === 'vmess') {
    const parts = [
      `vmess=${c.host}:${c.port}`,
      `method=${c.method === 'auto' ? 'chacha20-poly1305' : c.method || 'chacha20-poly1305'}`,
      `password=${c.uuid}`,
    ];
    if (c.transport?.type === 'ws') {
      parts.push(`obfs=${c.tls ? 'wss' : 'ws'}`);
      if (c.transport.host || c.sni) parts.push(`obfs-host=${c.transport.host || c.sni}`);
      if (c.transport.path) parts.push(`obfs-uri=${c.transport.path}`);
    } else if (c.tls) {
      parts.push('obfs=over-tls');
      if (c.sni) parts.push(`obfs-host=${c.sni}`);
    }
    if (c.aead !== false) parts.push('aead=true');
    parts.push(`tag=${node.name}`);
    return parts.join(', ');
  }
  if (c.protocol === 'vless') {
    const parts = [
      `vless=${c.host}:${c.port}`,
      'method=none',
      `password=${c.uuid}`,
    ];
    if (c.transport?.type === 'ws') {
      parts.push(`obfs=${c.tls ? 'wss' : 'ws'}`);
      if (c.transport.host || c.sni) parts.push(`obfs-host=${c.transport.host || c.sni}`);
      if (c.transport.path) parts.push(`obfs-uri=${c.transport.path}`);
    } else if (c.tls) {
      parts.push('obfs=over-tls');
      if (c.sni) parts.push(`obfs-host=${c.sni}`);
    }
    parts.push(`tag=${node.name}`);
    return parts.join(', ');
  }
  if (c.protocol === 'trojan') {
    const parts = [
      `trojan=${c.host}:${c.port}`,
      `password=${c.password}`,
      'over-tls=true',
      `tls-verification=${c.skipCertVerify ? 'false' : 'true'}`,
    ];
    if (c.sni) parts.push(`tls-host=${c.sni}`);
    if (c.transport?.type === 'ws') {
      parts.push('obfs=wss');
      if (c.transport.path) parts.push(`obfs-uri=${c.transport.path}`);
    }
    parts.push(`tag=${node.name}`);
    return parts.join(', ');
  }
  return '';
}

function exportQx(nodes: ResolvedNode[], profile: RoutingProfile, mode: ExportMode): string {
  const lines = nodes.map(formatQxLine).filter(Boolean);
  if (mode === 'nodes') {
    return lines.join('\n') + '\n';
  }
  const groups = evaluatePolicyGroups(profile, nodes);
  const out: string[] = ['[general]', 'server_check_url=' + profile.testUrl, '', '[server_local]', ...lines, '', '[policy]'];
  for (const group of groups) {
    const g = group.config;
    const members = group.members.map((m) => (m === 'DIRECT' ? 'direct' : m === 'REJECT' ? 'reject' : m));
    if (g.type === 'select') {
      out.push(`static=${g.name}, ${members.join(', ')}`);
    } else {
      out.push(`url-latency-benchmark=${g.name}, ${members.join(', ')}, check-interval=${g.interval || profile.testInterval}`);
    }
  }
  out.push('', '[filter_local]');
  for (const rule of profile.rules) {
    if (!rule.enabled) continue;
    const policy = rule.policy === 'DIRECT' ? 'direct' : rule.policy === 'REJECT' ? 'reject' : rule.policy;
    if (rule.type === 'FINAL') out.push(`final, ${policy}`);
    else if (rule.type === 'DOMAIN') out.push(`host, ${rule.value}, ${policy}`);
    else if (rule.type === 'DOMAIN-SUFFIX') out.push(`host-suffix, ${rule.value}, ${policy}`);
    else if (rule.type === 'DOMAIN-KEYWORD') out.push(`host-keyword, ${rule.value}, ${policy}`);
    else if (rule.type === 'IP-CIDR') out.push(`ip-cidr, ${rule.value}, ${policy}`);
    else if (rule.type === 'IP-CIDR6') out.push(`ip6-cidr, ${rule.value}, ${policy}`);
    else if (rule.type === 'GEOIP') out.push(`geoip, ${rule.value.toLowerCase()}, ${policy}`);
  }
  out.push('');
  return out.join('\n');
}

function exportEgern(nodes: ResolvedNode[], profile: RoutingProfile, mode: ExportMode): string {
  const proxies = nodes.map((node) => {
    const c = node.config;
    if (c.protocol === 'ss') {
      return {
        shadowsocks: {
          name: node.name,
          server: c.host,
          port: c.port,
          cipher: c.method,
          password: c.password,
          ...(c.udp ? { udp_relay: true } : {}),
        },
      };
    }
    if (c.protocol === 'trojan') {
      return {
        trojan: {
          name: node.name,
          server: c.host,
          port: c.port,
          password: c.password,
          ...(c.sni ? { sni: c.sni } : {}),
          ...(c.skipCertVerify ? { skip_tls_verify: true } : {}),
        },
      };
    }
    if (c.protocol === 'hysteria2') {
      return {
        hysteria2: {
          name: node.name,
          server: c.host,
          port: c.port,
          auth: c.password,
          ...(c.sni ? { sni: c.sni } : {}),
          ...(c.skipCertVerify ? { skip_tls_verify: true } : {}),
        },
      };
    }
    return { [c.protocol]: buildClashProxyObject(node) };
  });

  if (mode === 'nodes') {
    return stringifyYaml({ proxies });
  }

  const groups = evaluatePolicyGroups(profile, nodes);
  const policyGroups = groups.map((group) => {
    const g = group.config;
    if (g.type === 'select') {
      return {
        select: {
          name: g.name,
          policies: group.members,
        },
      };
    }
    return {
      auto_test: {
        name: g.name,
        policies: group.members,
        url: g.testUrl || profile.testUrl,
        interval: g.interval || profile.testInterval,
        tolerance: g.tolerance ?? 60,
      },
    };
  });

  const rules: Record<string, unknown>[] = [];
  for (const rule of profile.rules) {
    if (!rule.enabled) continue;
    if (rule.type === 'FINAL') rules.push({ default: { policy: rule.policy } });
    else if (rule.type === 'DOMAIN') rules.push({ domain: { match: rule.value, policy: rule.policy } });
    else if (rule.type === 'DOMAIN-SUFFIX') rules.push({ domain_suffix: { match: rule.value, policy: rule.policy } });
    else if (rule.type === 'DOMAIN-KEYWORD') rules.push({ domain_keyword: { match: rule.value, policy: rule.policy } });
    else if (rule.type === 'IP-CIDR' || rule.type === 'IP-CIDR6') {
      rules.push({ ip_cidr: { match: rule.value, policy: rule.policy } });
    } else if (rule.type === 'GEOIP') {
      rules.push({ geoip: { match: rule.value, policy: rule.policy } });
    }
  }

  return stringifyYaml({
    dns: { upstream: { alidns: 'https://dns.alidns.com/dns-query' } },
    proxies,
    policy_groups: policyGroups,
    rules,
  });
}

function formatShareUri(node: ResolvedNode): string {
  const c = node.config;
  const hostPart = c.host.includes(':') ? `[${c.host}]` : c.host;
  const tag = encodeURIComponent(node.name);

  switch (c.protocol) {
    case 'ss': {
      const cred = Buffer.from(`${c.method || 'aes-128-gcm'}:${c.password || ''}`, 'utf8').toString('base64');
      const params = new URLSearchParams();
      if (c.shadowTls) {
        const opts = [
          'shadow-tls',
          `password=${c.shadowTls.password}`,
          `version=${c.shadowTls.version}`,
          ...(c.shadowTls.sni ? [`host=${c.shadowTls.sni}`] : []),
        ];
        params.set('plugin', opts.join(';'));
      } else if (c.obfs) {
        const opts = ['obfs-local', `obfs=${c.obfs}`, ...(c.obfsHost ? [`obfs-host=${c.obfsHost}`] : [])];
        params.set('plugin', opts.join(';'));
      }
      const query = params.toString() ? `?${params.toString()}` : '';
      return `ss://${cred}@${hostPart}:${c.port}${query}#${tag}`;
    }
    case 'vmess': {
      const payload: Record<string, unknown> = {
        v: '2',
        ps: node.name,
        add: c.host,
        port: String(c.port),
        id: c.uuid || '',
        aid: String(c.alterId ?? 0),
        scy: c.method || 'auto',
        net: c.transport?.type || 'tcp',
        type: 'none',
        host: c.transport?.host || '',
        path: c.transport?.path || c.transport?.serviceName || '',
        tls: c.tls ? 'tls' : '',
        sni: c.sni || '',
        ...(c.alpn?.length ? { alpn: c.alpn.join(',') } : {}),
        ...(c.clientFingerprint ? { fp: c.clientFingerprint } : {}),
      };
      return `vmess://${Buffer.from(JSON.stringify(payload), 'utf8').toString('base64')}`;
    }
    case 'vless': {
      const params = new URLSearchParams();
      params.set('encryption', 'none');
      params.set('type', c.transport?.type || 'tcp');
      if (c.reality) {
        params.set('security', 'reality');
        params.set('pbk', c.reality.publicKey);
        if (c.reality.shortId) params.set('sid', c.reality.shortId);
        if (c.reality.fingerprint || c.clientFingerprint) {
          params.set('fp', c.reality.fingerprint || c.clientFingerprint || 'chrome');
        }
        if (c.reality.spiderX) params.set('spx', c.reality.spiderX);
      } else if (c.tls) {
        params.set('security', 'tls');
      } else {
        params.set('security', 'none');
      }
      if (c.sni) params.set('sni', c.sni);
      if (c.flow) params.set('flow', c.flow);
      if (c.alpn?.length) params.set('alpn', c.alpn.join(','));
      if (c.skipCertVerify) params.set('allowInsecure', '1');
      if (c.transport?.path) params.set('path', c.transport.path);
      if (c.transport?.host) params.set('host', c.transport.host);
      if (c.transport?.serviceName) params.set('serviceName', c.transport.serviceName);
      if (c.transport?.xhttpMode) params.set('mode', c.transport.xhttpMode);
      return `vless://${encodeURIComponent(c.uuid || '')}@${hostPart}:${c.port}?${params.toString()}#${tag}`;
    }
    case 'trojan': {
      const params = new URLSearchParams();
      params.set('security', 'tls');
      if (c.sni) params.set('sni', c.sni);
      if (c.skipCertVerify) params.set('allowInsecure', '1');
      if (c.alpn?.length) params.set('alpn', c.alpn.join(','));
      if (c.transport && c.transport.type !== 'tcp') {
        params.set('type', c.transport.type);
        if (c.transport.path) params.set('path', c.transport.path);
        if (c.transport.host) params.set('host', c.transport.host);
        if (c.transport.serviceName) params.set('serviceName', c.transport.serviceName);
      }
      return `trojan://${encodeURIComponent(c.password || '')}@${hostPart}:${c.port}?${params.toString()}#${tag}`;
    }
    case 'hysteria2': {
      const params = new URLSearchParams();
      if (c.sni) params.set('sni', c.sni);
      if (c.skipCertVerify) params.set('insecure', '1');
      if (c.certFingerprintSha256) params.set('pinSHA256', c.certFingerprintSha256);
      if (c.portHopping) params.set('mport', c.portHopping);
      if (c.obfs) params.set('obfs', c.obfs);
      if (c.obfsPassword) params.set('obfs-password', c.obfsPassword);
      const q = params.toString();
      return `hysteria2://${encodeURIComponent(c.password || '')}@${hostPart}:${c.port}${q ? `?${q}` : ''}#${tag}`;
    }
    case 'tuic': {
      const params = new URLSearchParams();
      if (c.sni) params.set('sni', c.sni);
      if (c.alpn?.length) params.set('alpn', c.alpn.join(','));
      if (c.congestionControl) params.set('congestion_control', c.congestionControl);
      if (c.udpRelayMode) params.set('udp_relay_mode', c.udpRelayMode);
      if (c.skipCertVerify) params.set('allow_insecure', '1');
      const user = c.uuid
        ? `${encodeURIComponent(c.uuid)}:${encodeURIComponent(c.password || '')}`
        : encodeURIComponent(c.token || '');
      return `tuic://${user}@${hostPart}:${c.port}?${params.toString()}#${tag}`;
    }
    case 'wireguard': {
      const params = new URLSearchParams();
      if (c.wgPublicKey) params.set('publickey', c.wgPublicKey);
      if (c.wgPresharedKey) params.set('presharedkey', c.wgPresharedKey);
      if (c.wgSelfIp) params.set('address', [c.wgSelfIp, c.wgSelfIpV6].filter(Boolean).join(','));
      if (c.wgReserved?.length) params.set('reserved', c.wgReserved.join(','));
      if (c.wgMtu) params.set('mtu', String(c.wgMtu));
      return `wireguard://${encodeURIComponent(c.wgPrivateKey || '')}@${hostPart}:${c.port}?${params.toString()}#${tag}`;
    }
    case 'snell': {
      const params = new URLSearchParams();
      params.set('version', String(c.snellVersion ?? 4));
      if (c.obfs) params.set('obfs', c.obfs);
      if (c.obfsHost) params.set('obfs-host', c.obfsHost);
      return `snell://${encodeURIComponent(c.psk || '')}@${hostPart}:${c.port}?${params.toString()}#${tag}`;
    }
    case 'anytls': {
      const params = new URLSearchParams();
      if (c.sni) params.set('sni', c.sni);
      if (c.skipCertVerify) params.set('insecure', '1');
      if (c.alpn?.length) params.set('alpn', c.alpn.join(','));
      const q = params.toString();
      return `anytls://${encodeURIComponent(c.password || '')}@${hostPart}:${c.port}${q ? `?${q}` : ''}#${tag}`;
    }
  }
}

function exportShareUriList(nodes: ResolvedNode[], forPreview: boolean): string {
  const lines = nodes.map(formatShareUri).join('\n');
  if (forPreview) {
    return lines ? `${lines}\n` : '# 无兼容节点\n';
  }
  return Buffer.from(lines, 'utf8').toString('base64');
}

export function generateExport(options: ExportOptions): ExportPreviewResult {
  const meta = CLIENT_MAP[options.client];
  const mode: ExportMode = meta.supportsModes.includes(options.mode)
    ? options.mode
    : meta.defaultMode;
  const masked = Boolean(options.masked);
  const forPreview = Boolean(options.forPreview);

  const { resolved, report } = prepareNodes(options.client, options.nodes, masked);

  let content = '';
  switch (options.client) {
    case 'surge':
      content = exportSurge(resolved, options.profile, mode, masked, options.managedUrl);
      break;
    case 'clash':
      content = exportClashOrStash('clash', resolved, options.profile, mode);
      break;
    case 'stash':
      content = exportClashOrStash('stash', resolved, options.profile, mode);
      break;
    case 'singbox':
      content = exportSingbox(resolved, options.profile, mode, masked);
      break;
    case 'loon':
      content = exportLoon(resolved, options.profile, mode);
      break;
    case 'qx':
      content = exportQx(resolved, options.profile, mode);
      break;
    case 'egern':
      content = exportEgern(resolved, options.profile, mode);
      break;
    case 'shadowrocket':
    case 'v2box':
      content = exportShareUriList(resolved, forPreview);
      break;
  }

  const filename =
    options.filename?.trim() ||
    `tower-${options.client}${mode === 'nodes' ? '-nodes' : ''}.${meta.fileExtension}`;

  return {
    content,
    contentType: meta.contentType,
    filename,
    masked,
    report: {
      ...report,
      mode,
    },
  };
}
