import React, { useEffect, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Plus,
  Save,
  Trash2,
  Network,
  Layers,
  ListFilter,
} from 'lucide-react';
import type {
  PolicyGroupConfig,
  PolicyGroupType,
  RoutingProfile,
  RuleEntry,
} from '../../shared/types.js';
import { api } from '../api.js';

interface RulesViewProps {
  profile: RoutingProfile | null;
  onRefresh: () => Promise<void>;
  onNotify: (msg: string, isError?: boolean) => void;
}

const PRESETS: Array<{ id: RoutingProfile['preset']; label: string; desc: string }> = [
  { id: 'standard', label: '标准分流', desc: '全局代理、自动测速与主流直连分流' },
  { id: 'low-multiplier', label: '低倍率自动池', desc: '自动聚合 <=1x 低倍率节点优先测速' },
  { id: 'residential-isolated', label: '高倍率 / 家宽隔离', desc: '家宽与高倍率节点独立成组，避免误消耗' },
];

const RULE_TYPES: RuleEntry['type'][] = [
  'DOMAIN-SUFFIX',
  'DOMAIN-KEYWORD',
  'DOMAIN',
  'IP-CIDR',
  'IP-CIDR6',
  'GEOIP',
  'FINAL',
];

const GROUP_TYPES: PolicyGroupType[] = ['select', 'url-test', 'fallback', 'load-balance'];

export function RulesView({ profile, onRefresh, onNotify }: RulesViewProps) {
  const [draft, setDraft] = useState<RoutingProfile | null>(profile);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [applyingPreset, setApplyingPreset] = useState(false);

  // New group inputs
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupType, setNewGroupType] = useState<PolicyGroupType>('url-test');
  const [newGroupInclude, setNewGroupInclude] = useState('');
  const [newGroupExclude, setNewGroupExclude] = useState('');

  // New rule inputs
  const [newRuleType, setNewRuleType] = useState<RuleEntry['type']>('DOMAIN-SUFFIX');
  const [newRuleValue, setNewRuleValue] = useState('');
  const [newRulePolicy, setNewRulePolicy] = useState('Proxy');
  const [newRuleNoResolve, setNewRuleNoResolve] = useState(false);

  useEffect(() => {
    if (profile && !dirty) {
      setDraft(profile);
    }
  }, [profile, dirty]);

  if (!draft) {
    return (
      <div className="rounded-lg border border-[#E5E7EB] p-8 text-center text-xs text-[#6B7280] dark:border-[#242429]">
        正在加载规则方案...
      </div>
    );
  }

  function updateDraft(updater: (prev: RoutingProfile) => RoutingProfile) {
    setDraft((prev) => (prev ? updater(prev) : prev));
    setDirty(true);
  }

  async function handleSave() {
    if (!draft) return;
    setSaving(true);
    try {
      const res = await api.saveRouting(draft);
      setDraft(res.profile);
      setDirty(false);
      await onRefresh();
      onNotify('规则方案与策略组已保存');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : '保存失败', true);
    } finally {
      setSaving(false);
    }
  }

  async function handlePreset(preset: RoutingProfile['preset']) {
    if (
      !window.confirm('切换预设将重置当前策略组与分流规则（会保留 Tailscale 设置），确认继续？')
    ) {
      return;
    }
    setApplyingPreset(true);
    try {
      const res = await api.applyRoutingPreset(preset);
      setDraft(res.profile);
      setDirty(false);
      await onRefresh();
      onNotify('已切换规则预设方案');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : '切换预设失败', true);
    } finally {
      setApplyingPreset(false);
    }
  }

  function moveGroup(index: number, delta: -1 | 1) {
    updateDraft((prev) => {
      const next = [...prev.groups];
      const target = index + delta;
      if (target < 0 || target >= next.length) return prev;
      const [item] = next.splice(index, 1);
      next.splice(target, 0, item);
      return { ...prev, groups: next };
    });
  }

  function updateGroup(id: string, patch: Partial<PolicyGroupConfig>) {
    updateDraft((prev) => ({
      ...prev,
      groups: prev.groups.map((g) => (g.id === id ? { ...g, ...patch } : g)),
    }));
  }

  function addGroup(e: React.FormEvent) {
    e.preventDefault();
    if (!newGroupName.trim()) return;
    const entry: PolicyGroupConfig = {
      id: `grp-${Date.now()}`,
      name: newGroupName.trim(),
      type: newGroupType,
      includeRegex: newGroupInclude.trim() || undefined,
      excludeRegex: newGroupExclude.trim() || undefined,
    };
    updateDraft((prev) => ({ ...prev, groups: [...prev.groups, entry] }));
    setNewGroupName('');
    setNewGroupInclude('');
    setNewGroupExclude('');
  }

  function addRule(e: React.FormEvent) {
    e.preventDefault();
    if (newRuleType !== 'FINAL' && !newRuleValue.trim()) return;
    const entry: RuleEntry = {
      id: `rule-${Date.now()}`,
      type: newRuleType,
      value: newRuleType === 'FINAL' ? '' : newRuleValue.trim(),
      policy: newRulePolicy.trim() || 'Proxy',
      noResolve:
        (newRuleType === 'IP-CIDR' || newRuleType === 'IP-CIDR6' || newRuleType === 'GEOIP') &&
        newRuleNoResolve,
      enabled: true,
    };
    updateDraft((prev) => {
      // Insert before FINAL rule if present
      const finalIdx = prev.rules.findIndex((r) => r.type === 'FINAL');
      if (finalIdx >= 0 && entry.type !== 'FINAL') {
        const next = [...prev.rules];
        next.splice(finalIdx, 0, entry);
        return { ...prev, rules: next };
      }
      return { ...prev, rules: [...prev.rules, entry] };
    });
    setNewRuleValue('');
  }

  const policyOptions = [
    ...draft.groups.map((g) => g.name),
    ...(draft.tailscale.enabled ? [draft.tailscale.policyName] : []),
    'DIRECT',
    'REJECT',
  ];

  return (
    <div className="space-y-5">
      {/* Header + Save */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#E5E7EB] bg-[#F7F7F8] p-4 dark:border-[#242429] dark:bg-[#141417]">
        <div>
          <h2 className="text-sm font-semibold">分流预设与全局测速参数</h2>
          <p className="text-xs text-[#6B7280] dark:text-[#9CA3AF]">
            选择精简预设快速起步，或按需自定义策略组正则过滤、分流规则与 Tailscale 内网回家。
          </p>
        </div>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || !dirty}
          className="h-9 rounded bg-[#EA580C] px-4 text-xs font-medium text-[#FFFFFF] inline-flex items-center gap-1.5 hover:bg-[#C2410C] disabled:opacity-40 dark:bg-[#F97316] dark:text-[#0A0A0B]"
        >
          <Save className="w-3.5 h-3.5" />
          {saving ? '保存中...' : dirty ? '保存更改' : '已保存'}
        </button>
      </div>

      {/* Presets */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {PRESETS.map((p) => {
          const active = draft.preset === p.id;
          return (
            <button
              key={p.id}
              type="button"
              disabled={applyingPreset}
              onClick={() => handlePreset(p.id)}
              className={`text-left rounded-lg border p-3.5 transition-colors ${
                active
                  ? 'border-[#EA580C] bg-[#EA580C]/5 dark:border-[#F97316] dark:bg-[#F97316]/10'
                  : 'border-[#E5E7EB] bg-[#FFFFFF] hover:border-[#D1D5DB] dark:border-[#242429] dark:bg-[#141417]'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold">{p.label}</span>
                {active && (
                  <span className="tabular-mono text-[10px] font-medium text-[#EA580C] dark:text-[#F97316]">
                    当前方案
                  </span>
                )}
              </div>
              <p className="mt-1 text-[11px] text-[#6B7280] dark:text-[#9CA3AF]">{p.desc}</p>
            </button>
          );
        })}
      </div>

      {/* Global Test URL */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 rounded-lg border border-[#E5E7EB] bg-[#FFFFFF] p-4 dark:border-[#242429] dark:bg-[#141417]">
        <div className="md:col-span-2">
          <label className="block text-[11px] text-[#6B7280] mb-1">客户端测速 URL (url-test)</label>
          <input
            type="url"
            value={draft.testUrl}
            onChange={(e) => updateDraft((prev) => ({ ...prev, testUrl: e.target.value }))}
            className="w-full h-8 rounded border border-[#E5E7EB] bg-[#F7F7F8] px-2.5 text-xs tabular-mono dark:border-[#242429] dark:bg-[#0A0A0B]"
          />
        </div>
        <div>
          <label className="block text-[11px] text-[#6B7280] mb-1">测速间隔（秒）</label>
          <input
            type="number"
            min={60}
            max={86400}
            value={draft.testInterval}
            onChange={(e) =>
              updateDraft((prev) => ({ ...prev, testInterval: Number(e.target.value) || 300 }))
            }
            className="w-full h-8 rounded border border-[#E5E7EB] bg-[#F7F7F8] px-2.5 text-xs tabular-mono dark:border-[#242429] dark:bg-[#0A0A0B]"
          />
        </div>
      </div>

      {/* Policy Groups */}
      <section className="rounded-lg border border-[#E5E7EB] bg-[#FFFFFF] dark:border-[#242429] dark:bg-[#141417] overflow-hidden">
        <div className="px-4 py-3 border-b border-[#E5E7EB] dark:border-[#242429] flex items-center gap-2">
          <Layers className="w-4 h-4 text-[#EA580C] dark:text-[#F97316]" />
          <h3 className="text-sm font-semibold">策略组编排 ({draft.groups.length})</h3>
        </div>

        <div className="divide-y divide-[#E5E7EB] dark:divide-[#242429]">
          {draft.groups.map((grp, idx) => (
            <div key={grp.id} className="p-3.5 grid grid-cols-1 md:grid-cols-12 gap-2 items-center">
              <div className="md:col-span-3 flex items-center gap-1.5">
                <div className="flex flex-col">
                  <button
                    type="button"
                    onClick={() => moveGroup(idx, -1)}
                    disabled={idx === 0}
                    className="p-0.5 text-[#6B7280] hover:text-[#0A0A0A] disabled:opacity-25 dark:hover:text-[#FAFAFA]"
                  >
                    <ArrowUp className="w-3 h-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => moveGroup(idx, 1)}
                    disabled={idx === draft.groups.length - 1}
                    className="p-0.5 text-[#6B7280] hover:text-[#0A0A0A] disabled:opacity-25 dark:hover:text-[#FAFAFA]"
                  >
                    <ArrowDown className="w-3 h-3" />
                  </button>
                </div>
                <input
                  type="text"
                  value={grp.name}
                  onChange={(e) => updateGroup(grp.id, { name: e.target.value })}
                  className="w-full h-8 rounded border border-[#E5E7EB] bg-[#F7F7F8] px-2 text-xs font-medium dark:border-[#242429] dark:bg-[#0A0A0B]"
                />
              </div>
              <div className="md:col-span-2">
                <select
                  value={grp.type}
                  onChange={(e) => updateGroup(grp.id, { type: e.target.value as PolicyGroupType })}
                  className="w-full h-8 rounded border border-[#E5E7EB] bg-[#F7F7F8] px-2 text-xs tabular-mono dark:border-[#242429] dark:bg-[#0A0A0B]"
                >
                  {GROUP_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
              <div className="md:col-span-3">
                <input
                  type="text"
                  value={grp.includeRegex ?? ''}
                  onChange={(e) =>
                    updateGroup(grp.id, { includeRegex: e.target.value || undefined })
                  }
                  placeholder="包含正则（如 HK|香港）"
                  className="w-full h-8 rounded border border-[#E5E7EB] bg-[#F7F7F8] px-2 text-xs tabular-mono dark:border-[#242429] dark:bg-[#0A0A0B]"
                />
              </div>
              <div className="md:col-span-3">
                <input
                  type="text"
                  value={grp.excludeRegex ?? ''}
                  onChange={(e) =>
                    updateGroup(grp.id, { excludeRegex: e.target.value || undefined })
                  }
                  placeholder="排除正则（如 家宽|3x）"
                  className="w-full h-8 rounded border border-[#E5E7EB] bg-[#F7F7F8] px-2 text-xs tabular-mono dark:border-[#242429] dark:bg-[#0A0A0B]"
                />
              </div>
              <div className="md:col-span-1 flex justify-end">
                <button
                  type="button"
                  onClick={() =>
                    updateDraft((prev) => ({
                      ...prev,
                      groups: prev.groups.filter((g) => g.id !== grp.id),
                    }))
                  }
                  className="p-1.5 rounded text-[#6B7280] hover:text-[#EA580C]"
                  title="删除策略组"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>

        <form
          onSubmit={addGroup}
          className="p-3.5 bg-[#F7F7F8] dark:bg-[#0F0F12] border-t border-[#E5E7EB] dark:border-[#242429] grid grid-cols-1 md:grid-cols-12 gap-2"
        >
          <input
            type="text"
            value={newGroupName}
            onChange={(e) => setNewGroupName(e.target.value)}
            placeholder="新增策略组名（如 🇭🇰 香港）"
            className="md:col-span-3 h-8 rounded border border-[#E5E7EB] bg-[#FFFFFF] px-2.5 text-xs dark:border-[#242429] dark:bg-[#0A0A0B]"
          />
          <select
            value={newGroupType}
            onChange={(e) => setNewGroupType(e.target.value as PolicyGroupType)}
            className="md:col-span-2 h-8 rounded border border-[#E5E7EB] bg-[#FFFFFF] px-2 text-xs tabular-mono dark:border-[#242429] dark:bg-[#0A0A0B]"
          >
            {GROUP_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <input
            type="text"
            value={newGroupInclude}
            onChange={(e) => setNewGroupInclude(e.target.value)}
            placeholder="包含正则（可选）"
            className="md:col-span-3 h-8 rounded border border-[#E5E7EB] bg-[#FFFFFF] px-2.5 text-xs tabular-mono dark:border-[#242429] dark:bg-[#0A0A0B]"
          />
          <input
            type="text"
            value={newGroupExclude}
            onChange={(e) => setNewGroupExclude(e.target.value)}
            placeholder="排除正则（可选）"
            className="md:col-span-2 h-8 rounded border border-[#E5E7EB] bg-[#FFFFFF] px-2.5 text-xs tabular-mono dark:border-[#242429] dark:bg-[#0A0A0B]"
          />
          <button
            type="submit"
            className="md:col-span-2 h-8 rounded border border-[#0A0A0A] bg-[#0A0A0A] text-[#FFFFFF] text-xs font-medium inline-flex items-center justify-center gap-1 dark:border-[#FAFAFA] dark:bg-[#FAFAFA] dark:text-[#0A0A0B]"
          >
            <Plus className="w-3.5 h-3.5" /> 添加策略组
          </button>
        </form>
      </section>

      {/* Custom Rules */}
      <section className="rounded-lg border border-[#E5E7EB] bg-[#FFFFFF] dark:border-[#242429] dark:bg-[#141417] overflow-hidden">
        <div className="px-4 py-3 border-b border-[#E5E7EB] dark:border-[#242429] flex items-center gap-2">
          <ListFilter className="w-4 h-4 text-[#EA580C] dark:text-[#F97316]" />
          <h3 className="text-sm font-semibold">分流规则 ({draft.rules.length})</h3>
        </div>

        <div className="divide-y divide-[#E5E7EB] dark:divide-[#242429] max-h-[340px] overflow-y-auto">
          {draft.rules.map((rule) => (
            <div
              key={rule.id}
              className={`px-4 py-2 flex flex-wrap items-center justify-between gap-2 text-xs ${
                !rule.enabled ? 'opacity-45' : ''
              }`}
            >
              <div className="flex items-center gap-2 min-w-0 flex-wrap">
                <input
                  type="checkbox"
                  checked={rule.enabled}
                  onChange={() =>
                    updateDraft((prev) => ({
                      ...prev,
                      rules: prev.rules.map((r) =>
                        r.id === rule.id ? { ...r, enabled: !r.enabled } : r,
                      ),
                    }))
                  }
                  className="accent-[#EA580C]"
                />
                <span className="tabular-mono rounded border border-[#E5E7EB] bg-[#F7F7F8] px-1.5 py-0.5 text-[10px] dark:border-[#242429] dark:bg-[#0A0A0B]">
                  {rule.type}
                </span>
                {rule.value && <span className="tabular-mono font-medium">{rule.value}</span>}
                <span className="text-[#9CA3AF]">→</span>
                <span className="font-medium text-[#EA580C] dark:text-[#F97316]">{rule.policy}</span>
                {rule.noResolve && (
                  <span className="tabular-mono text-[10px] text-[#6B7280]">no-resolve</span>
                )}
              </div>
              <button
                type="button"
                onClick={() =>
                  updateDraft((prev) => ({
                    ...prev,
                    rules: prev.rules.filter((r) => r.id !== rule.id),
                  }))
                }
                className="p-1 text-[#6B7280] hover:text-[#EA580C]"
                title="删除规则"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>

        <form
          onSubmit={addRule}
          className="p-3.5 bg-[#F7F7F8] dark:bg-[#0F0F12] border-t border-[#E5E7EB] dark:border-[#242429] grid grid-cols-1 md:grid-cols-12 gap-2 items-center"
        >
          <select
            value={newRuleType}
            onChange={(e) => setNewRuleType(e.target.value as RuleEntry['type'])}
            className="md:col-span-3 h-8 rounded border border-[#E5E7EB] bg-[#FFFFFF] px-2 text-xs tabular-mono dark:border-[#242429] dark:bg-[#0A0A0B]"
          >
            {RULE_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <input
            type="text"
            value={newRuleValue}
            disabled={newRuleType === 'FINAL'}
            onChange={(e) => setNewRuleValue(e.target.value)}
            placeholder={newRuleType === 'FINAL' ? '兜底规则无需匹配值' : '如 openai.com / 192.168.1.0/24'}
            className="md:col-span-4 h-8 rounded border border-[#E5E7EB] bg-[#FFFFFF] px-2.5 text-xs tabular-mono disabled:opacity-40 dark:border-[#242429] dark:bg-[#0A0A0B]"
          />
          <select
            value={newRulePolicy}
            onChange={(e) => setNewRulePolicy(e.target.value)}
            className="md:col-span-2 h-8 rounded border border-[#E5E7EB] bg-[#FFFFFF] px-2 text-xs dark:border-[#242429] dark:bg-[#0A0A0B]"
          >
            {Array.from(new Set(policyOptions)).map((pol) => (
              <option key={pol} value={pol}>
                {pol}
              </option>
            ))}
          </select>
          <label className="md:col-span-1 inline-flex items-center gap-1 text-[11px] text-[#6B7280] whitespace-nowrap">
            <input
              type="checkbox"
              checked={newRuleNoResolve}
              onChange={(e) => setNewRuleNoResolve(e.target.checked)}
              className="accent-[#EA580C]"
            />
            no-res
          </label>
          <button
            type="submit"
            className="md:col-span-2 h-8 rounded border border-[#0A0A0A] bg-[#0A0A0A] text-[#FFFFFF] text-xs font-medium inline-flex items-center justify-center gap-1 dark:border-[#FAFAFA] dark:bg-[#FAFAFA] dark:text-[#0A0A0B]"
          >
            <Plus className="w-3.5 h-3.5" /> 添加规则
          </button>
        </form>
      </section>

      {/* Tailscale Home Access */}
      <section className="rounded-lg border border-[#E5E7EB] bg-[#FFFFFF] p-4 dark:border-[#242429] dark:bg-[#141417]">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-2">
            <Network className="w-4 h-4 text-[#EA580C] dark:text-[#F97316]" />
            <div>
              <h3 className="text-sm font-semibold">Tailscale 内网回家（可选）</h3>
              <p className="text-xs text-[#6B7280] dark:text-[#9CA3AF]">
                导出 Surge 时自动写入 <code className="tabular-mono">interactive-login = true</code> 与{' '}
                <code className="tabular-mono">[Tailscale ...]</code> 段；导出 Clash / Stash / sing-box 时生成对应路由与网段规则。
              </p>
            </div>
          </div>
          <label className="inline-flex items-center gap-2 text-xs font-medium cursor-pointer">
            <input
              type="checkbox"
              checked={draft.tailscale.enabled}
              onChange={(e) =>
                updateDraft((prev) => ({
                  ...prev,
                  tailscale: { ...prev.tailscale, enabled: e.target.checked },
                }))
              }
              className="accent-[#EA580C]"
            />
            启用 Tailscale 内网回家
          </label>
        </div>

        {draft.tailscale.enabled && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 pt-2 border-t border-[#E5E7EB] dark:border-[#242429]">
            <div>
              <label className="block text-[11px] text-[#6B7280] mb-1">段名称 (Section Name)</label>
              <input
                type="text"
                value={draft.tailscale.sectionName}
                onChange={(e) =>
                  updateDraft((prev) => ({
                    ...prev,
                    tailscale: { ...prev.tailscale, sectionName: e.target.value },
                  }))
                }
                placeholder="Home"
                className="w-full h-8 rounded border border-[#E5E7EB] bg-[#F7F7F8] px-2.5 text-xs tabular-mono dark:border-[#242429] dark:bg-[#0A0A0B]"
              />
            </div>
            <div>
              <label className="block text-[11px] text-[#6B7280] mb-1">策略名称 (Policy Name)</label>
              <input
                type="text"
                value={draft.tailscale.policyName}
                onChange={(e) =>
                  updateDraft((prev) => ({
                    ...prev,
                    tailscale: { ...prev.tailscale, policyName: e.target.value },
                  }))
                }
                placeholder="Tailscale"
                className="w-full h-8 rounded border border-[#E5E7EB] bg-[#F7F7F8] px-2.5 text-xs tabular-mono dark:border-[#242429] dark:bg-[#0A0A0B]"
              />
            </div>
            <div>
              <label className="block text-[11px] text-[#6B7280] mb-1">内网网段 CIDR（逗号分隔）</label>
              <input
                type="text"
                value={draft.tailscale.subnetCidrs.join(', ')}
                onChange={(e) =>
                  updateDraft((prev) => ({
                    ...prev,
                    tailscale: {
                      ...prev.tailscale,
                      subnetCidrs: e.target.value
                        .split(/[,\n]/)
                        .map((s) => s.trim())
                        .filter(Boolean),
                    },
                  }))
                }
                placeholder="100.64.0.0/10, 192.168.1.0/24"
                className="w-full h-8 rounded border border-[#E5E7EB] bg-[#F7F7F8] px-2.5 text-xs tabular-mono dark:border-[#242429] dark:bg-[#0A0A0B]"
              />
            </div>
            <div>
              <label className="block text-[11px] text-[#6B7280] mb-1">Tailnet 域名（可选）</label>
              <input
                type="text"
                value={draft.tailscale.tailnetDomain ?? ''}
                onChange={(e) =>
                  updateDraft((prev) => ({
                    ...prev,
                    tailscale: { ...prev.tailscale, tailnetDomain: e.target.value || undefined },
                  }))
                }
                placeholder="tailxxxx.ts.net"
                className="w-full h-8 rounded border border-[#E5E7EB] bg-[#F7F7F8] px-2.5 text-xs tabular-mono dark:border-[#242429] dark:bg-[#0A0A0B]"
              />
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
