import type { PolicyGroupConfig, RoutingProfile, RuleEntry, TailscaleConfig } from '../../shared/types.js';

export const DEFAULT_TEST_URL = 'http://www.gstatic.com/generate_204';

export const DEFAULT_TAILSCALE: TailscaleConfig = {
  enabled: false,
  sectionName: 'TowerHome',
  subnetCidrs: ['100.64.0.0/10', '192.168.1.0/24'],
  tailnetDomain: '',
  exitNode: '',
  policyName: 'Tailscale',
  interactiveLogin: true,
  authKey: '',
};

export const DEFAULT_RULES: RuleEntry[] = [
  { id: 'r-ai-openai', type: 'DOMAIN-SUFFIX', value: 'openai.com', policy: 'AI', enabled: true, comment: 'OpenAI' },
  { id: 'r-ai-chatgpt', type: 'DOMAIN-SUFFIX', value: 'chatgpt.com', policy: 'AI', enabled: true, comment: 'ChatGPT' },
  { id: 'r-ai-anthropic', type: 'DOMAIN-SUFFIX', value: 'anthropic.com', policy: 'AI', enabled: true, comment: 'Anthropic' },
  { id: 'r-ai-claude', type: 'DOMAIN-SUFFIX', value: 'claude.ai', policy: 'AI', enabled: true, comment: 'Claude' },
  { id: 'r-ai-gemini', type: 'DOMAIN-SUFFIX', value: 'gemini.google.com', policy: 'AI', enabled: true, comment: 'Gemini' },
  { id: 'r-dev-github', type: 'DOMAIN-SUFFIX', value: 'github.com', policy: 'Proxy', enabled: true, comment: 'GitHub' },
  { id: 'r-dev-ghassets', type: 'DOMAIN-SUFFIX', value: 'githubusercontent.com', policy: 'Proxy', enabled: true, comment: 'GitHub Raw' },
  { id: 'r-google', type: 'DOMAIN-SUFFIX', value: 'google.com', policy: 'Proxy', enabled: true, comment: 'Google' },
  { id: 'r-youtube', type: 'DOMAIN-SUFFIX', value: 'youtube.com', policy: 'Media', enabled: true, comment: 'YouTube' },
  { id: 'r-netflix', type: 'DOMAIN-SUFFIX', value: 'netflix.com', policy: 'Media', enabled: true, comment: 'Netflix' },
  { id: 'r-telegram-1', type: 'IP-CIDR', value: '91.108.4.0/22', policy: 'Proxy', noResolve: true, enabled: true, comment: 'Telegram' },
  { id: 'r-telegram-2', type: 'IP-CIDR', value: '149.154.160.0/20', policy: 'Proxy', noResolve: true, enabled: true, comment: 'Telegram' },
  { id: 'r-cn-domain', type: 'DOMAIN-SUFFIX', value: 'cn', policy: 'DIRECT', enabled: true, comment: '中国顶级域' },
  { id: 'r-lan-10', type: 'IP-CIDR', value: '10.0.0.0/8', policy: 'DIRECT', noResolve: true, enabled: true, comment: 'LAN' },
  { id: 'r-lan-172', type: 'IP-CIDR', value: '172.16.0.0/12', policy: 'DIRECT', noResolve: true, enabled: true, comment: 'LAN' },
  { id: 'r-lan-192', type: 'IP-CIDR', value: '192.168.0.0/16', policy: 'DIRECT', noResolve: true, enabled: true, comment: 'LAN' },
  { id: 'r-geoip-cn', type: 'GEOIP', value: 'CN', policy: 'DIRECT', enabled: true, comment: '中国大陆直连' },
  { id: 'r-final', type: 'FINAL', value: '', policy: 'Proxy', enabled: true, comment: '默认兜底' },
];

export function buildPresetGroups(preset: RoutingProfile['preset']): PolicyGroupConfig[] {
  if (preset === 'low-multiplier') {
    return [
      {
        id: 'g-proxy',
        name: 'Proxy',
        type: 'select',
        extraPolicies: ['LowRate', 'Auto', 'HongKong', 'Japan', 'Singapore', 'UnitedStates', 'DIRECT'],
      },
      {
        id: 'g-lowrate',
        name: 'LowRate',
        type: 'url-test',
        maxMultiplier: 0.5,
        excludeResidential: true,
        interval: 300,
        tolerance: 80,
      },
      {
        id: 'g-auto',
        name: 'Auto',
        type: 'url-test',
        maxMultiplier: 1,
        excludeResidential: true,
        interval: 300,
        tolerance: 80,
      },
      {
        id: 'g-ai',
        name: 'AI',
        type: 'select',
        extraPolicies: ['UnitedStates', 'Japan', 'Singapore', 'Proxy'],
      },
      {
        id: 'g-media',
        name: 'Media',
        type: 'select',
        extraPolicies: ['LowRate', 'HongKong', 'Taiwan', 'Japan', 'Singapore', 'UnitedStates'],
      },
      { id: 'g-hk', name: 'HongKong', type: 'url-test', includeRegions: ['HK'], interval: 300, tolerance: 60 },
      { id: 'g-tw', name: 'Taiwan', type: 'url-test', includeRegions: ['TW'], interval: 300, tolerance: 60 },
      { id: 'g-jp', name: 'Japan', type: 'url-test', includeRegions: ['JP'], interval: 300, tolerance: 60 },
      { id: 'g-sg', name: 'Singapore', type: 'url-test', includeRegions: ['SG'], interval: 300, tolerance: 60 },
      { id: 'g-us', name: 'UnitedStates', type: 'url-test', includeRegions: ['US'], interval: 300, tolerance: 80 },
    ];
  }

  if (preset === 'residential-isolated') {
    return [
      {
        id: 'g-proxy',
        name: 'Proxy',
        type: 'select',
        extraPolicies: ['Auto', 'HongKong', 'Japan', 'Singapore', 'UnitedStates', 'Residential', 'HighRate', 'DIRECT'],
      },
      {
        id: 'g-auto',
        name: 'Auto',
        type: 'url-test',
        maxMultiplier: 1.5,
        excludeResidential: true,
        interval: 300,
        tolerance: 80,
      },
      {
        id: 'g-ai',
        name: 'AI',
        type: 'select',
        extraPolicies: ['Residential', 'UnitedStates', 'Japan', 'Singapore', 'Proxy'],
      },
      {
        id: 'g-media',
        name: 'Media',
        type: 'select',
        extraPolicies: ['Residential', 'HongKong', 'Japan', 'Singapore', 'UnitedStates', 'Proxy'],
      },
      {
        id: 'g-res',
        name: 'Residential',
        type: 'select',
        requireResidential: true,
      },
      {
        id: 'g-high',
        name: 'HighRate',
        type: 'select',
        minMultiplier: 1.51,
      },
      { id: 'g-hk', name: 'HongKong', type: 'url-test', includeRegions: ['HK'], excludeResidential: true, interval: 300, tolerance: 60 },
      { id: 'g-jp', name: 'Japan', type: 'url-test', includeRegions: ['JP'], excludeResidential: true, interval: 300, tolerance: 60 },
      { id: 'g-sg', name: 'Singapore', type: 'url-test', includeRegions: ['SG'], excludeResidential: true, interval: 300, tolerance: 60 },
      { id: 'g-us', name: 'UnitedStates', type: 'url-test', includeRegions: ['US'], excludeResidential: true, interval: 300, tolerance: 80 },
    ];
  }

  return [
    {
      id: 'g-proxy',
      name: 'Proxy',
      type: 'select',
      extraPolicies: ['Auto', 'HongKong', 'Taiwan', 'Japan', 'Singapore', 'UnitedStates', 'DIRECT'],
    },
    {
      id: 'g-auto',
      name: 'Auto',
      type: 'url-test',
      excludeResidential: true,
      interval: 300,
      tolerance: 80,
    },
    {
      id: 'g-ai',
      name: 'AI',
      type: 'select',
      extraPolicies: ['UnitedStates', 'Japan', 'Singapore', 'Proxy'],
    },
    {
      id: 'g-media',
      name: 'Media',
      type: 'select',
      extraPolicies: ['HongKong', 'Taiwan', 'Japan', 'Singapore', 'UnitedStates', 'Proxy'],
    },
    { id: 'g-hk', name: 'HongKong', type: 'url-test', includeRegions: ['HK'], interval: 300, tolerance: 60 },
    { id: 'g-tw', name: 'Taiwan', type: 'url-test', includeRegions: ['TW'], interval: 300, tolerance: 60 },
    { id: 'g-jp', name: 'Japan', type: 'url-test', includeRegions: ['JP'], interval: 300, tolerance: 60 },
    { id: 'g-sg', name: 'Singapore', type: 'url-test', includeRegions: ['SG'], interval: 300, tolerance: 60 },
    { id: 'g-us', name: 'UnitedStates', type: 'url-test', includeRegions: ['US'], interval: 300, tolerance: 80 },
  ];
}

export function createDefaultRoutingProfile(
  preset: RoutingProfile['preset'] = 'standard',
): RoutingProfile {
  return {
    id: 'default',
    name: 'Tower 默认规则方案',
    preset,
    testUrl: DEFAULT_TEST_URL,
    testInterval: 300,
    groups: buildPresetGroups(preset),
    rules: DEFAULT_RULES.map((rule) => ({ ...rule })),
    tailscale: { ...DEFAULT_TAILSCALE, subnetCidrs: [...DEFAULT_TAILSCALE.subnetCidrs] },
    updatedAt: new Date().toISOString(),
  };
}
