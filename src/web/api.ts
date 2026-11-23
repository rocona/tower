import type {
  ClientTarget,
  ExportChannelRecord,
  ExportMode,
  ExportPreviewResult,
  NodeRecord,
  ProxyProtocol,
  RoutingProfile,
  SecurityStatus,
  SourceRecord,
} from '../shared/types.js';

export interface ChannelWithUrl extends ExportChannelRecord {
  subscribeUrl: string;
}

export interface OverviewStats {
  sourceCount: number;
  enabledSourceCount: number;
  totalNodes: number;
  activeNodes: number;
  blockedNodes: number;
  channelCount: number;
  activeChannelCount: number;
  regionCounts: Record<string, number>;
  protocolCounts: Record<string, number>;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    ...(init?.headers as Record<string, string> | undefined),
  };
  if (init?.body !== undefined && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(path, {
    credentials: 'same-origin',
    ...init,
    headers,
  });
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!res.ok) {
    const msg =
      data && typeof data === 'object' && 'error' in data
        ? String((data as { error: unknown }).error)
        : `请求失败 (${res.status})`;
    throw new Error(msg);
  }
  return data as T;
}

export const api = {
  authStatus: () => request<SecurityStatus>('/api/auth/status'),
  authSetup: (password: string) =>
    request<{ ok: boolean }>('/api/auth/setup', {
      method: 'POST',
      body: JSON.stringify({ password }),
    }),
  authLogin: (password: string) =>
    request<{ ok: boolean }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ password }),
    }),
  authLogout: () => request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),
  authChangePassword: (currentPassword: string, newPassword: string) =>
    request<{ ok: boolean }>('/api/auth/password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
    }),

  getOverview: () => request<OverviewStats>('/api/overview'),

  listSources: () => request<{ sources: SourceRecord[] }>('/api/sources'),
  createSource: (payload: {
    name: string;
    kind: 'subscription' | 'manual';
    url?: string;
    userAgent?: string;
    syncNow?: boolean;
  }) =>
    request<{ source: SourceRecord; syncError?: string }>('/api/sources', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateSource: (
    id: string,
    patch: { name?: string; url?: string | null; enabled?: boolean; userAgent?: string | null },
  ) =>
    request<{ source: SourceRecord }>(`/api/sources/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  deleteSource: (id: string) =>
    request<{ ok: boolean }>(`/api/sources/${id}`, { method: 'DELETE' }),
  syncSource: (id: string) =>
    request<{ source: SourceRecord; nodeCount: number; filteredCount: number; format: string }>(
      `/api/sources/${id}/sync`,
      { method: 'POST' },
    ),
  syncAllSources: () =>
    request<{
      results: Array<{ id: string; name: string; ok: boolean; nodeCount?: number; error?: string }>;
    }>('/api/sources/sync-all', { method: 'POST' }),
  importManualText: (text: string, filterNotices = false) =>
    request<{ importedCount: number; filteredCount: number; source: SourceRecord }>(
      '/api/sources/manual/import',
      {
        method: 'POST',
        body: JSON.stringify({ text, filterNotices }),
      },
    ),
  addManualNode: (payload: {
    name: string;
    protocol: ProxyProtocol;
    host: string;
    port: number;
    password?: string;
    uuid?: string;
    method?: string;
    psk?: string;
    snellVersion?: number;
    sni?: string;
    tls?: boolean;
    skipCertVerify?: boolean;
    certFingerprintSha256?: string;
    portHopping?: string;
    shadowTlsPassword?: string;
    shadowTlsVersion?: 2 | 3;
    shadowTlsSni?: string;
    wgPrivateKey?: string;
    wgPublicKey?: string;
    wgSelfIp?: string;
  }) =>
    request<{ ok: boolean }>('/api/sources/manual/node', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  listNodes: (params?: { sourceId?: string; region?: string; protocol?: string }) => {
    const sp = new URLSearchParams();
    if (params?.sourceId) sp.set('sourceId', params.sourceId);
    if (params?.region) sp.set('region', params.region);
    if (params?.protocol) sp.set('protocol', params.protocol);
    const qs = sp.toString() ? `?${sp.toString()}` : '';
    return request<{ nodes: NodeRecord[] }>(`/api/nodes${qs}`);
  },
  updateNode: (
    id: string,
    patch: { blocked?: boolean; customName?: string | null; regionOverride?: string | null },
  ) =>
    request<{ node: NodeRecord }>(`/api/nodes/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  bulkNodes: (
    ids: string[],
    action: 'block' | 'unblock' | 'delete' | 'setRegion',
    regionOverride?: string | null,
  ) =>
    request<{ ok: boolean; affected: number }>('/api/nodes/bulk', {
      method: 'POST',
      body: JSON.stringify({ ids, action, regionOverride }),
    }),
  deleteNode: (id: string) => request<{ ok: boolean }>(`/api/nodes/${id}`, { method: 'DELETE' }),
  probeNodes: (payload: { nodeIds?: string[]; region?: string }) =>
    request<{
      testedCount: number;
      results: Array<{ nodeId: string; latencyMs: number | null; error: string | null }>;
      note: string;
    }>('/api/nodes/probe', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  getRouting: () => request<{ profile: RoutingProfile }>('/api/routing'),
  saveRouting: (profile: RoutingProfile) =>
    request<{ profile: RoutingProfile }>('/api/routing', {
      method: 'PUT',
      body: JSON.stringify({ profile }),
    }),
  applyRoutingPreset: (preset: RoutingProfile['preset']) =>
    request<{ profile: RoutingProfile }>('/api/routing/preset', {
      method: 'POST',
      body: JSON.stringify({ preset }),
    }),

  listChannels: () => request<{ baseUrl: string; channels: ChannelWithUrl[] }>('/api/channels'),
  createChannel: (payload: {
    name: string;
    client: ClientTarget;
    mode: ExportMode;
    sourceIds?: string[];
    includeRegions?: string[];
    excludeBlocked?: boolean;
    customFilename?: string | null;
  }) =>
    request<{ channel: ChannelWithUrl }>('/api/channels', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateChannel: (
    id: string,
    patch: {
      name?: string;
      client?: ClientTarget;
      mode?: ExportMode;
      enabled?: boolean;
      sourceIds?: string[];
      includeRegions?: string[];
      excludeBlocked?: boolean;
      customFilename?: string | null;
    },
  ) =>
    request<{ channel: ChannelWithUrl }>(`/api/channels/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  rotateChannel: (id: string) =>
    request<{ channel: ChannelWithUrl }>(`/api/channels/${id}/rotate`, { method: 'POST' }),
  deleteChannel: (id: string) =>
    request<{ ok: boolean }>(`/api/channels/${id}`, { method: 'DELETE' }),

  previewExport: (payload: {
    client: ClientTarget;
    mode: ExportMode;
    masked: boolean;
    channelId?: string;
    sourceIds?: string[];
    includeRegions?: string[];
    excludeBlocked?: boolean;
  }) =>
    request<ExportPreviewResult>('/api/export/preview', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  generateQrCode: (text: string) =>
    request<{ dataUrl: string }>('/api/export/qrcode', {
      method: 'POST',
      body: JSON.stringify({ text }),
    }),
};
