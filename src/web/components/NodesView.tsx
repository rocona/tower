import { useMemo, useState } from 'react';
import {
  Activity,
  Ban,
  CheckCircle2,
  RefreshCw,
  Search,
  Trash2,
  Globe2,
  Info,
} from 'lucide-react';
import { REGIONS, REGION_MAP } from '../../shared/regions.js';
import type { NodeRecord, SourceRecord } from '../../shared/types.js';
import { api, type OverviewStats } from '../api.js';
import { DotWorldMap } from './DotWorldMap.js';

interface NodesViewProps {
  overview: OverviewStats | null;
  nodes: NodeRecord[];
  sources: SourceRecord[];
  onRefresh: () => Promise<void>;
  onNotify: (msg: string, isError?: boolean) => void;
}

const PROTO_LABELS: Record<string, string> = {
  ss: 'SS',
  vmess: 'VMess',
  vless: 'VLESS',
  trojan: 'Trojan',
  hysteria2: 'Hy2',
  tuic: 'TUIC',
  wireguard: 'WG',
  snell: 'Snell',
  anytls: 'AnyTLS',
};

export function NodesView({ overview, nodes, sources, onRefresh, onNotify }: NodesViewProps) {
  const [selectedRegion, setSelectedRegion] = useState<string | null>(null);
  const [sourceFilter, setSourceFilter] = useState<string>('ALL');
  const [protoFilter, setProtoFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'blocked'>('all');
  const [query, setQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [probing, setProbing] = useState(false);
  const [probingNodeId, setProbingNodeId] = useState<string | null>(null);
  const [syncingAll, setSyncingAll] = useState(false);

  const sourceNameMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const s of sources) map[s.id] = s.name;
    return map;
  }, [sources]);

  const regionCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const n of nodes) {
      if (!n.blocked) {
        counts[n.region] = (counts[n.region] ?? 0) + 1;
      }
    }
    return counts;
  }, [nodes]);

  const sortedRegionChips = useMemo(() => {
    return Object.entries(regionCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([code, count]) => ({
        code,
        count,
        meta: REGION_MAP[code] ?? REGION_MAP.OTHER,
      }));
  }, [regionCounts]);

  const filteredNodes = useMemo(() => {
    const q = query.trim().toLowerCase();
    return nodes.filter((n) => {
      if (selectedRegion && n.region !== selectedRegion) return false;
      if (sourceFilter !== 'ALL' && n.sourceId !== sourceFilter) return false;
      if (protoFilter !== 'ALL' && n.protocol !== protoFilter) return false;
      if (statusFilter === 'active' && n.blocked) return false;
      if (statusFilter === 'blocked' && !n.blocked) return false;
      if (q) {
        const displayName = n.customName || n.originalName;
        const hay = `${displayName} ${n.host} ${n.protocol} ${n.tags.join(' ')} ${n.region}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [nodes, selectedRegion, sourceFilter, protoFilter, statusFilter, query]);

  const availableProtos = useMemo(() => {
    const set = new Set<string>();
    for (const n of nodes) set.add(n.protocol);
    return Array.from(set).sort();
  }, [nodes]);

  const allVisibleSelected =
    filteredNodes.length > 0 && filteredNodes.every((n) => selectedIds.has(n.id));

  function toggleSelectAll() {
    if (allVisibleSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredNodes.map((n) => n.id)));
    }
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleToggleBlock(node: NodeRecord) {
    try {
      await api.updateNode(node.id, { blocked: !node.blocked });
      await onRefresh();
      const displayName = node.customName || node.originalName;
      onNotify(node.blocked ? `已取消屏蔽 ${displayName}` : `已屏蔽 ${displayName}`);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : '操作失败', true);
    }
  }

  async function handleRegionChange(node: NodeRecord, regionCode: string) {
    try {
      await api.updateNode(node.id, { regionOverride: regionCode === 'AUTO' ? null : regionCode });
      await onRefresh();
      onNotify(`已更新 ${node.customName || node.originalName} 地区归属`);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : '地区修改失败', true);
    }
  }

  async function handleBulk(action: 'block' | 'unblock' | 'delete') {
    const ids = Array.from(selectedIds);
    if (!ids.length) return;
    if (action === 'delete' && !window.confirm(`确认删除选中的 ${ids.length} 个节点吗？`)) {
      return;
    }
    try {
      const res = await api.bulkNodes(ids, action);
      setSelectedIds(new Set());
      await onRefresh();
      const label = action === 'block' ? '屏蔽' : action === 'unblock' ? '启用' : '删除';
      onNotify(`已批量${label} ${res.affected} 个节点`);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : '批量操作失败', true);
    }
  }

  async function handleProbeVisible() {
    const targetIds = selectedIds.size > 0
      ? Array.from(selectedIds).slice(0, 60)
      : filteredNodes.filter((n) => !n.blocked).slice(0, 40).map((n) => n.id);
    if (!targetIds.length) {
      onNotify('当前没有可测速的活跃节点', true);
      return;
    }
    setProbing(true);
    try {
      const res = await api.probeNodes({ nodeIds: targetIds });
      await onRefresh();
      onNotify(`TCP 测速完成：共检测 ${res.testedCount} 个节点`);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : '测速失败', true);
    } finally {
      setProbing(false);
    }
  }

  async function handleProbeSingle(nodeId: string) {
    setProbingNodeId(nodeId);
    try {
      const res = await api.probeNodes({ nodeIds: [nodeId] });
      await onRefresh();
      const first = res.results[0];
      if (first?.latencyMs !== null && first?.latencyMs !== undefined) {
        onNotify(`TCP 握手延迟 ${first.latencyMs} ms`);
      } else {
        onNotify(`节点不可达：${first?.error ?? '连接超时'}`, true);
      }
    } catch (err) {
      onNotify(err instanceof Error ? err.message : '测速失败', true);
    } finally {
      setProbingNodeId(null);
    }
  }

  async function handleSyncAll() {
    setSyncingAll(true);
    try {
      const res = await api.syncAllSources();
      await onRefresh();
      const okCount = res.results.filter((r) => r.ok).length;
      onNotify(`同步完成：${okCount} / ${res.results.length} 个订阅源成功`);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : '同步失败', true);
    } finally {
      setSyncingAll(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* KPI Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="rounded-lg border border-[#E5E7EB] bg-[#F7F7F8] p-3.5 dark:border-[#242429] dark:bg-[#141417]">
          <div className="text-[11px] font-medium uppercase tracking-wider text-[#6B7280] dark:text-[#9CA3AF]">
            活跃节点
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="tabular-mono text-2xl font-semibold">
              {overview?.activeNodes ?? 0}
            </span>
            <span className="tabular-mono text-xs text-[#6B7280] dark:text-[#9CA3AF]">
              / {overview?.totalNodes ?? 0} 总计
            </span>
          </div>
        </div>

        <div className="rounded-lg border border-[#E5E7EB] bg-[#F7F7F8] p-3.5 dark:border-[#242429] dark:bg-[#141417]">
          <div className="text-[11px] font-medium uppercase tracking-wider text-[#6B7280] dark:text-[#9CA3AF]">
            覆盖地区
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="tabular-mono text-2xl font-semibold">
              {sortedRegionChips.length}
            </span>
            <span className="text-xs text-[#6B7280] dark:text-[#9CA3AF]">离线地区识别</span>
          </div>
        </div>

        <div className="rounded-lg border border-[#E5E7EB] bg-[#F7F7F8] p-3.5 dark:border-[#242429] dark:bg-[#141417]">
          <div className="text-[11px] font-medium uppercase tracking-wider text-[#6B7280] dark:text-[#9CA3AF]">
            订阅与来源
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="tabular-mono text-2xl font-semibold">
              {overview?.enabledSourceCount ?? 0}
            </span>
            <span className="tabular-mono text-xs text-[#6B7280] dark:text-[#9CA3AF]">
              / {overview?.sourceCount ?? 0} 来源
            </span>
          </div>
        </div>

        <div className="rounded-lg border border-[#E5E7EB] bg-[#F7F7F8] p-3.5 dark:border-[#242429] dark:bg-[#141417]">
          <div className="text-[11px] font-medium uppercase tracking-wider text-[#6B7280] dark:text-[#9CA3AF]">
            托管通道
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="tabular-mono text-2xl font-semibold">
              {overview?.activeChannelCount ?? 0}
            </span>
            <span className="tabular-mono text-xs text-[#6B7280] dark:text-[#9CA3AF]">
              / {overview?.channelCount ?? 0} 通道
            </span>
          </div>
        </div>
      </div>

      {/* Offline Dot World Map */}
      <DotWorldMap
        regionCounts={regionCounts}
        selectedRegion={selectedRegion}
        onSelectRegion={setSelectedRegion}
      />

      {/* Region Chips */}
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => setSelectedRegion(null)}
          className={`h-7 rounded border px-2.5 text-xs font-medium transition-colors ${
            selectedRegion === null
              ? 'border-[#0A0A0A] bg-[#0A0A0A] text-[#FFFFFF] dark:border-[#FAFAFA] dark:bg-[#FAFAFA] dark:text-[#0A0A0B]'
              : 'border-[#E5E7EB] bg-[#FFFFFF] text-[#6B7280] hover:text-[#0A0A0A] dark:border-[#242429] dark:bg-[#141417] dark:text-[#9CA3AF] dark:hover:text-[#FAFAFA]'
          }`}
        >
          全部地区 <span className="tabular-mono ml-1 opacity-80">{overview?.activeNodes ?? 0}</span>
        </button>
        {sortedRegionChips.map(({ code, count, meta }) => (
          <button
            key={code}
            type="button"
            onClick={() => setSelectedRegion(selectedRegion === code ? null : code)}
            className={`h-7 rounded border px-2.5 text-xs font-medium transition-colors ${
              selectedRegion === code
                ? 'border-[#EA580C] bg-[#EA580C] text-[#FFFFFF] dark:border-[#F97316] dark:bg-[#F97316] dark:text-[#0A0A0B]'
                : 'border-[#E5E7EB] bg-[#FFFFFF] text-[#0A0A0A] hover:border-[#D1D5DB] dark:border-[#242429] dark:bg-[#141417] dark:text-[#FAFAFA] dark:hover:border-[#3A3A44]'
            }`}
          >
            {meta.flag} {meta.nameZh} <span className="tabular-mono ml-1 opacity-75">{count}</span>
          </button>
        ))}
      </div>

      {/* Filter & Actions Bar */}
      <div className="rounded-lg border border-[#E5E7EB] bg-[#FFFFFF] dark:border-[#242429] dark:bg-[#141417] overflow-hidden">
        <div className="p-3 border-b border-[#E5E7EB] dark:border-[#242429] flex flex-wrap items-center gap-2 justify-between">
          <div className="flex flex-wrap items-center gap-2 flex-1 min-w-[220px]">
            <div className="relative flex-1 min-w-[160px] max-w-xs">
              <Search className="w-3.5 h-3.5 text-[#6B7280] absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜索节点名、主机、标签..."
                className="w-full h-8 rounded border border-[#E5E7EB] bg-[#F7F7F8] pl-8 pr-3 text-xs outline-none focus:border-[#EA580C] dark:border-[#242429] dark:bg-[#0A0A0B] dark:focus:border-[#F97316]"
              />
            </div>

            <select
              value={sourceFilter}
              onChange={(e) => setSourceFilter(e.target.value)}
              className="h-8 rounded border border-[#E5E7EB] bg-[#F7F7F8] px-2 text-xs outline-none dark:border-[#242429] dark:bg-[#0A0A0B]"
            >
              <option value="ALL">全部来源</option>
              {sources.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>

            <select
              value={protoFilter}
              onChange={(e) => setProtoFilter(e.target.value)}
              className="h-8 rounded border border-[#E5E7EB] bg-[#F7F7F8] px-2 text-xs outline-none dark:border-[#242429] dark:bg-[#0A0A0B]"
            >
              <option value="ALL">全部协议</option>
              {availableProtos.map((p) => (
                <option key={p} value={p}>
                  {PROTO_LABELS[p] ?? p}
                </option>
              ))}
            </select>

            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as 'all' | 'active' | 'blocked')}
              className="h-8 rounded border border-[#E5E7EB] bg-[#F7F7F8] px-2 text-xs outline-none dark:border-[#242429] dark:bg-[#0A0A0B]"
            >
              <option value="all">全部状态</option>
              <option value="active">仅启用</option>
              <option value="blocked">仅已屏蔽</option>
            </select>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleSyncAll}
              disabled={syncingAll}
              className="h-8 rounded border border-[#E5E7EB] bg-[#FFFFFF] px-2.5 text-xs font-medium inline-flex items-center gap-1.5 hover:bg-[#F7F7F8] disabled:opacity-50 dark:border-[#242429] dark:bg-[#0A0A0B] dark:hover:bg-[#1C1C21]"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${syncingAll ? 'animate-spin' : ''}`} />
              刷新订阅
            </button>
            <button
              type="button"
              onClick={handleProbeVisible}
              disabled={probing}
              className="h-8 rounded bg-[#EA580C] px-3 text-xs font-medium text-[#FFFFFF] inline-flex items-center gap-1.5 hover:bg-[#C2410C] disabled:opacity-50 dark:bg-[#F97316] dark:text-[#0A0A0B] dark:hover:bg-[#EA580C] dark:hover:text-[#FFFFFF]"
            >
              <Activity className={`w-3.5 h-3.5 ${probing ? 'animate-pulse' : ''}`} />
              {probing
                ? '测速中...'
                : selectedIds.size > 0
                  ? `测速选中 (${selectedIds.size})`
                  : selectedRegion
                    ? `测速 ${selectedRegion}`
                    : 'TCP 测速'}
            </button>
          </div>
        </div>

        {/* Probe Perspective Hint & Bulk Bar */}
        <div className="px-3 py-2 border-b border-[#E5E7EB] bg-[#F7F7F8] dark:border-[#242429] dark:bg-[#0F0F12] flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#6B7280] dark:text-[#9CA3AF]">
          <span className="inline-flex items-center gap-1.5">
            <Info className="w-3.5 h-3.5 text-[#EA580C] dark:text-[#F97316]" />
            延迟探测基于 Tower 部署服务器网络视角的 TCP 握手耗时，仅作连通性参考。
          </span>
          {selectedIds.size > 0 ? (
            <div className="flex items-center gap-2">
              <span className="tabular-mono text-[#0A0A0A] dark:text-[#FAFAFA]">
                已选 {selectedIds.size} 项
              </span>
              <button
                type="button"
                onClick={() => handleBulk('block')}
                className="underline hover:text-[#0A0A0A] dark:hover:text-[#FAFAFA]"
              >
                批量屏蔽
              </button>
              <button
                type="button"
                onClick={() => handleBulk('unblock')}
                className="underline hover:text-[#0A0A0A] dark:hover:text-[#FAFAFA]"
              >
                取消屏蔽
              </button>
              <button
                type="button"
                onClick={() => handleBulk('delete')}
                className="underline text-[#EA580C] dark:text-[#F97316]"
              >
                删除
              </button>
            </div>
          ) : (
            <span className="tabular-mono">显示 {filteredNodes.length} / {nodes.length} 个节点</span>
          )}
        </div>

        {/* Nodes Table */}
        {filteredNodes.length === 0 ? (
          <div className="py-12 text-center text-sm text-[#6B7280] dark:text-[#9CA3AF]">
            <Globe2 className="w-6 h-6 mx-auto mb-2 opacity-40" />
            暂无匹配节点。请先在「订阅与节点」添加订阅源或导入自有节点。
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-[#E5E7EB] dark:border-[#242429] text-[11px] uppercase tracking-wider text-[#6B7280] dark:text-[#9CA3AF]">
                  <th className="py-2.5 pl-3 pr-2 w-8">
                    <input
                      type="checkbox"
                      checked={allVisibleSelected}
                      onChange={toggleSelectAll}
                      className="accent-[#EA580C]"
                    />
                  </th>
                  <th className="py-2.5 px-2 font-medium">节点名称</th>
                  <th className="py-2.5 px-2 font-medium">协议</th>
                  <th className="py-2.5 px-2 font-medium">地区</th>
                  <th className="py-2.5 px-2 font-medium hidden md:table-cell">主机 : 端口</th>
                  <th className="py-2.5 px-2 font-medium hidden lg:table-cell">来源</th>
                  <th className="py-2.5 px-2 font-medium text-right">延迟</th>
                  <th className="py-2.5 pl-2 pr-3 font-medium text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E5E7EB] dark:divide-[#242429]">
                {filteredNodes.map((node) => {
                  const regionMeta = REGION_MAP[node.region] ?? REGION_MAP.OTHER;
                  const isFast = node.latencyMs !== null && node.latencyMs < 150;
                  const displayName = node.customName || node.originalName;
                  return (
                    <tr
                      key={node.id}
                      className={`hover:bg-[#F7F7F8] dark:hover:bg-[#1B1B20] transition-colors ${
                        node.blocked ? 'opacity-50' : ''
                      }`}
                    >
                      <td className="py-2.5 pl-3 pr-2">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(node.id)}
                          onChange={() => toggleSelect(node.id)}
                          className="accent-[#EA580C]"
                        />
                      </td>
                      <td className="py-2.5 px-2 max-w-[260px]">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-medium text-[#0A0A0A] dark:text-[#FAFAFA] break-all">
                            {displayName}
                          </span>
                          {node.multiplier !== null && node.multiplier !== 1 && (
                            <span className="tabular-mono rounded border border-[#EA580C]/40 bg-[#EA580C]/10 px-1.5 py-0.5 text-[10px] font-medium text-[#EA580C] dark:text-[#F97316]">
                              {node.multiplier}x
                            </span>
                          )}
                          {node.tags
                            .filter((t) => !/^\d+(?:\.\d+)?x$/i.test(t))
                            .slice(0, 3)
                            .map((tag) => (
                              <span
                                key={tag}
                                className="rounded border border-[#E5E7EB] bg-[#F7F7F8] px-1.5 py-0.5 text-[10px] text-[#6B7280] dark:border-[#242429] dark:bg-[#0A0A0B] dark:text-[#9CA3AF]"
                              >
                                {tag}
                              </span>
                            ))}
                        </div>
                      </td>
                      <td className="py-2.5 px-2 whitespace-nowrap">
                        <span className="tabular-mono rounded border border-[#E5E7EB] bg-[#F7F7F8] px-1.5 py-0.5 text-[11px] dark:border-[#242429] dark:bg-[#0A0A0B]">
                          {PROTO_LABELS[node.protocol] ?? node.protocol}
                        </span>
                      </td>
                      <td className="py-2.5 px-2 whitespace-nowrap">
                        <select
                          value={node.regionOverride ?? 'AUTO'}
                          onChange={(e) => handleRegionChange(node, e.target.value)}
                          className="h-6 rounded border border-transparent hover:border-[#E5E7EB] dark:hover:border-[#242429] bg-transparent text-xs outline-none cursor-pointer"
                          title="点击可手动覆盖地区归属"
                        >
                          <option value="AUTO">
                            {regionMeta.flag} {regionMeta.nameZh}
                          </option>
                          {REGIONS.map((r) => (
                            <option key={r.code} value={r.code}>
                              {r.flag} {r.nameZh} ({r.code})
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="py-2.5 px-2 hidden md:table-cell tabular-mono text-[#6B7280] dark:text-[#9CA3AF]">
                        {node.host}:{node.port}
                      </td>
                      <td className="py-2.5 px-2 hidden lg:table-cell text-[#6B7280] dark:text-[#9CA3AF] max-w-[120px] truncate">
                        {sourceNameMap[node.sourceId] ?? '—'}
                      </td>
                      <td className="py-2.5 px-2 text-right whitespace-nowrap tabular-mono">
                        {node.latencyMs !== null ? (
                          <span className="inline-flex items-center gap-1.5">
                            <span
                              className={`w-1.5 h-1.5 rounded-full ${
                                isFast
                                  ? 'bg-[#0A0A0A] dark:bg-[#FAFAFA]'
                                  : 'bg-[#EA580C] dark:bg-[#F97316]'
                              }`}
                            />
                            {node.latencyMs} ms
                          </span>
                        ) : node.latencyError ? (
                          <span className="text-[#EA580C] dark:text-[#F97316]" title={node.latencyError}>
                            超时
                          </span>
                        ) : (
                          <span className="text-[#9CA3AF]">—</span>
                        )}
                      </td>
                      <td className="py-2.5 pl-2 pr-3 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => handleProbeSingle(node.id)}
                            disabled={probingNodeId === node.id}
                            className="p-1 rounded hover:bg-[#E5E7EB]/60 dark:hover:bg-[#242429] text-[#6B7280] hover:text-[#0A0A0A] dark:hover:text-[#FAFAFA]"
                            title="单节点 TCP 测速"
                          >
                            <Activity
                              className={`w-3.5 h-3.5 ${probingNodeId === node.id ? 'animate-pulse text-[#EA580C]' : ''}`}
                            />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleToggleBlock(node)}
                            className="p-1 rounded hover:bg-[#E5E7EB]/60 dark:hover:bg-[#242429] text-[#6B7280] hover:text-[#0A0A0A] dark:hover:text-[#FAFAFA]"
                            title={node.blocked ? '取消屏蔽' : '屏蔽该节点（刷新后保持）'}
                          >
                            {node.blocked ? (
                              <CheckCircle2 className="w-3.5 h-3.5 text-[#EA580C] dark:text-[#F97316]" />
                            ) : (
                              <Ban className="w-3.5 h-3.5" />
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={async () => {
                              if (!window.confirm(`删除节点「${displayName}」？`)) return;
                              try {
                                await api.deleteNode(node.id);
                                await onRefresh();
                                onNotify('节点已删除');
                              } catch (err) {
                                onNotify(err instanceof Error ? err.message : '删除失败', true);
                              }
                            }}
                            className="p-1 rounded hover:bg-[#E5E7EB]/60 dark:hover:bg-[#242429] text-[#6B7280] hover:text-[#EA580C]"
                            title="删除节点"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
