import React, { useState } from 'react';
import {
  Plus,
  RefreshCw,
  Trash2,
  Power,
  FileText,
  Server,
  Edit3,
  Check,
  X,
} from 'lucide-react';
import type { ProxyProtocol, SourceRecord } from '../../shared/types.js';
import { api } from '../api.js';
import { formatBytes, formatDateOnly, formatDateTime } from '../utils.js';

interface SourcesViewProps {
  sources: SourceRecord[];
  onRefresh: () => Promise<void>;
  onNotify: (msg: string, isError?: boolean) => void;
}

const MANUAL_PROTOCOLS: Array<{ id: ProxyProtocol; label: string }> = [
  { id: 'ss', label: 'Shadowsocks / SS2022' },
  { id: 'vless', label: 'VLESS' },
  { id: 'vmess', label: 'VMess' },
  { id: 'trojan', label: 'Trojan' },
  { id: 'hysteria2', label: 'Hysteria 2' },
  { id: 'tuic', label: 'TUIC' },
  { id: 'snell', label: 'Snell' },
  { id: 'anytls', label: 'AnyTLS' },
  { id: 'wireguard', label: 'WireGuard' },
];

export function SourcesView({ sources, onRefresh, onNotify }: SourcesViewProps) {
  // Add remote subscription state
  const [subName, setSubName] = useState('');
  const [subUrl, setSubUrl] = useState('');
  const [subUa, setSubUa] = useState('');
  const [creatingSub, setCreatingSub] = useState(false);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [syncingAll, setSyncingAll] = useState(false);

  // Inline edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editUrl, setEditUrl] = useState('');
  const [editUa, setEditUa] = useState('');

  // Manual import state
  const [manualTab, setManualTab] = useState<'paste' | 'form'>('paste');
  const [pasteText, setPasteText] = useState('');
  const [importingText, setImportingText] = useState(false);

  // Structured manual node form state
  const [mName, setMName] = useState('');
  const [mProto, setMProto] = useState<ProxyProtocol>('hysteria2');
  const [mHost, setMHost] = useState('');
  const [mPort, setMPort] = useState('443');
  const [mPassword, setMPassword] = useState('');
  const [mUuid, setMUuid] = useState('');
  const [mMethod, setMMethod] = useState('aes-256-gcm');
  const [mSni, setMSni] = useState('');
  const [mPinSha256, setMPinSha256] = useState('');
  const [mPortHopping, setMPortHopping] = useState('');
  const [mSnellVersion, setMSnellVersion] = useState('4');
  const [mShadowTlsPass, setMShadowTlsPass] = useState('');
  const [mShadowTlsSni, setMShadowTlsSni] = useState('');
  const [mWgPrivateKey, setMWgPrivateKey] = useState('');
  const [mWgPublicKey, setMWgPublicKey] = useState('');
  const [mWgSelfIp, setMWgSelfIp] = useState('172.16.0.2/32');
  const [mSkipVerify, setMSkipVerify] = useState(false);
  const [addingManual, setAddingManual] = useState(false);

  async function handleAddSubscription(e: React.FormEvent) {
    e.preventDefault();
    if (!subName.trim() || !subUrl.trim()) return;
    setCreatingSub(true);
    try {
      const res = await api.createSource({
        name: subName.trim(),
        kind: 'subscription',
        url: subUrl.trim(),
        userAgent: subUa.trim() || undefined,
        syncNow: true,
      });
      setSubName('');
      setSubUrl('');
      setSubUa('');
      await onRefresh();
      if (res.syncError) {
        onNotify(`订阅已添加，但首次同步失败：${res.syncError}`, true);
      } else {
        onNotify(`订阅「${res.source.name}」已添加并同步完成`);
      }
    } catch (err) {
      onNotify(err instanceof Error ? err.message : '添加订阅失败', true);
    } finally {
      setCreatingSub(false);
    }
  }

  async function handleSync(id: string) {
    setSyncingId(id);
    try {
      const res = await api.syncSource(id);
      await onRefresh();
      onNotify(`同步成功：${res.nodeCount} 个有效节点（过滤 ${res.filteredCount} 条公告）`);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : '同步失败', true);
    } finally {
      setSyncingId(null);
    }
  }

  async function handleSyncAll() {
    setSyncingAll(true);
    try {
      const res = await api.syncAllSources();
      await onRefresh();
      const okCount = res.results.filter((r) => r.ok).length;
      onNotify(`全部同步完成：${okCount} / ${res.results.length} 成功`);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : '同步失败', true);
    } finally {
      setSyncingAll(false);
    }
  }

  function startEdit(source: SourceRecord) {
    setEditingId(source.id);
    setEditName(source.name);
    setEditUrl(source.url ?? '');
    setEditUa(source.userAgent ?? '');
  }

  async function saveEdit(source: SourceRecord) {
    try {
      await api.updateSource(source.id, {
        name: editName.trim(),
        url: source.kind === 'subscription' ? editUrl.trim() : undefined,
        userAgent: editUa.trim() || null,
      });
      setEditingId(null);
      await onRefresh();
      onNotify('来源配置已更新');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : '更新失败', true);
    }
  }

  async function handleImportPaste(e: React.FormEvent) {
    e.preventDefault();
    if (!pasteText.trim()) return;
    setImportingText(true);
    try {
      const res = await api.importManualText(pasteText, false);
      setPasteText('');
      await onRefresh();
      onNotify(`成功导入 ${res.importedCount} 个自有节点`);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : '导入失败', true);
    } finally {
      setImportingText(false);
    }
  }

  async function handleAddManualNode(e: React.FormEvent) {
    e.preventDefault();
    if (!mName.trim() || !mHost.trim()) return;
    setAddingManual(true);
    try {
      await api.addManualNode({
        name: mName.trim(),
        protocol: mProto,
        host: mHost.trim(),
        port: Number(mPort) || 443,
        password: mPassword || undefined,
        uuid: mUuid || undefined,
        method: mProto === 'ss' ? mMethod : undefined,
        psk: mProto === 'snell' ? mPassword : undefined,
        snellVersion: mProto === 'snell' ? Number(mSnellVersion) || 4 : undefined,
        sni: mSni || undefined,
        tls: ['vless', 'trojan', 'hysteria2', 'tuic', 'anytls'].includes(mProto),
        skipCertVerify: mSkipVerify,
        certFingerprintSha256: mPinSha256 || undefined,
        portHopping: mPortHopping || undefined,
        shadowTlsPassword: mShadowTlsPass || undefined,
        shadowTlsVersion: mShadowTlsPass ? 3 : undefined,
        shadowTlsSni: mShadowTlsSni || undefined,
        wgPrivateKey: mProto === 'wireguard' ? mWgPrivateKey : undefined,
        wgPublicKey: mProto === 'wireguard' ? mWgPublicKey : undefined,
        wgSelfIp: mProto === 'wireguard' ? mWgSelfIp : undefined,
      });
      setMName('');
      setMHost('');
      setMPassword('');
      setMUuid('');
      setMPinSha256('');
      setMPortHopping('');
      await onRefresh();
      onNotify('自有节点已添加');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : '添加节点失败', true);
    } finally {
      setAddingManual(false);
    }
  }

  return (
    <div className="space-y-5">
      {/* Add Remote Subscription */}
      <section className="rounded-lg border border-[#E5E7EB] bg-[#F7F7F8] p-4 dark:border-[#242429] dark:bg-[#141417]">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <div>
            <h2 className="text-sm font-semibold">添加远程订阅</h2>
            <p className="text-xs text-[#6B7280] dark:text-[#9CA3AF]">
              自动识别 Base64、分享链接 URI、Clash YAML 与 Surge [Proxy]；默认过滤公告条目并保留节点原名。
            </p>
          </div>
          <button
            type="button"
            onClick={handleSyncAll}
            disabled={syncingAll}
            className="h-8 rounded border border-[#E5E7EB] bg-[#FFFFFF] px-3 text-xs font-medium inline-flex items-center gap-1.5 hover:bg-[#F7F7F8] disabled:opacity-50 dark:border-[#242429] dark:bg-[#0A0A0B]"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${syncingAll ? 'animate-spin' : ''}`} />
            同步全部订阅
          </button>
        </div>

        <form onSubmit={handleAddSubscription} className="grid grid-cols-1 md:grid-cols-12 gap-2.5">
          <input
            type="text"
            required
            value={subName}
            onChange={(e) => setSubName(e.target.value)}
            placeholder="名称（如：机场 A）"
            className="md:col-span-3 h-9 rounded border border-[#E5E7EB] bg-[#FFFFFF] px-3 text-xs outline-none focus:border-[#EA580C] dark:border-[#242429] dark:bg-[#0A0A0B] dark:focus:border-[#F97316]"
          />
          <input
            type="url"
            required
            value={subUrl}
            onChange={(e) => setSubUrl(e.target.value)}
            placeholder="https://example.com/subscribe?token=..."
            className="md:col-span-5 h-9 rounded border border-[#E5E7EB] bg-[#FFFFFF] px-3 text-xs tabular-mono outline-none focus:border-[#EA580C] dark:border-[#242429] dark:bg-[#0A0A0B] dark:focus:border-[#F97316]"
          />
          <input
            type="text"
            value={subUa}
            onChange={(e) => setSubUa(e.target.value)}
            placeholder="可选 User-Agent（默认 clash-verge）"
            className="md:col-span-2 h-9 rounded border border-[#E5E7EB] bg-[#FFFFFF] px-3 text-xs outline-none focus:border-[#EA580C] dark:border-[#242429] dark:bg-[#0A0A0B] dark:focus:border-[#F97316]"
          />
          <button
            type="submit"
            disabled={creatingSub}
            className="md:col-span-2 h-9 rounded bg-[#EA580C] text-[#FFFFFF] text-xs font-medium inline-flex items-center justify-center gap-1.5 hover:bg-[#C2410C] disabled:opacity-50 dark:bg-[#F97316] dark:text-[#0A0A0B]"
          >
            <Plus className="w-3.5 h-3.5" />
            {creatingSub ? '拉取中...' : '添加并同步'}
          </button>
        </form>
      </section>

      {/* Sources List */}
      <section className="space-y-2.5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">已配置的订阅源与来源 ({sources.length})</h2>
        </div>

        {sources.length === 0 ? (
          <div className="rounded-lg border border-dashed border-[#E5E7EB] p-8 text-center text-xs text-[#6B7280] dark:border-[#242429] dark:text-[#9CA3AF]">
            还没有订阅源，可在上方添加远程订阅或在下方导入自有节点。
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {sources.map((src) => {
              const used = (src.uploadBytes ?? 0) + (src.downloadBytes ?? 0);
              const total = src.totalBytes ?? 0;
              const pct = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0;
              const isEditing = editingId === src.id;

              return (
                <div
                  key={src.id}
                  className={`rounded-lg border border-[#E5E7EB] bg-[#FFFFFF] p-4 dark:border-[#242429] dark:bg-[#141417] ${
                    !src.enabled ? 'opacity-60' : ''
                  }`}
                >
                  {isEditing ? (
                    <div className="space-y-2">
                      <input
                        type="text"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="w-full h-8 rounded border border-[#E5E7EB] bg-[#F7F7F8] px-2.5 text-xs dark:border-[#242429] dark:bg-[#0A0A0B]"
                      />
                      {src.kind === 'subscription' && (
                        <>
                          <input
                            type="url"
                            value={editUrl}
                            onChange={(e) => setEditUrl(e.target.value)}
                            className="w-full h-8 rounded border border-[#E5E7EB] bg-[#F7F7F8] px-2.5 text-xs tabular-mono dark:border-[#242429] dark:bg-[#0A0A0B]"
                          />
                          <input
                            type="text"
                            value={editUa}
                            onChange={(e) => setEditUa(e.target.value)}
                            placeholder="可选 User-Agent"
                            className="w-full h-8 rounded border border-[#E5E7EB] bg-[#F7F7F8] px-2.5 text-xs dark:border-[#242429] dark:bg-[#0A0A0B]"
                          />
                        </>
                      )}
                      <div className="flex items-center justify-end gap-1.5 pt-1">
                        <button
                          type="button"
                          onClick={() => setEditingId(null)}
                          className="h-7 rounded border border-[#E5E7EB] px-2.5 text-xs inline-flex items-center gap-1 dark:border-[#242429]"
                        >
                          <X className="w-3 h-3" /> 取消
                        </button>
                        <button
                          type="button"
                          onClick={() => saveEdit(src)}
                          className="h-7 rounded bg-[#EA580C] text-[#FFFFFF] px-2.5 text-xs inline-flex items-center gap-1 dark:bg-[#F97316] dark:text-[#0A0A0B]"
                        >
                          <Check className="w-3 h-3" /> 保存
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-sm truncate">{src.name}</span>
                            <span className="tabular-mono rounded border border-[#E5E7EB] bg-[#F7F7F8] px-1.5 py-0.5 text-[10px] text-[#6B7280] dark:border-[#242429] dark:bg-[#0A0A0B] dark:text-[#9CA3AF]">
                              {src.kind === 'subscription' ? '远程订阅' : '自有节点'}
                            </span>
                          </div>
                          <div className="mt-1 text-[11px] text-[#6B7280] dark:text-[#9CA3AF] tabular-mono">
                            节点 <strong className="text-[#0A0A0A] dark:text-[#FAFAFA]">{src.nodeCount}</strong>
                            {src.filteredCount > 0 && ` · 过滤公告 ${src.filteredCount}`}
                            {src.lastSyncedAt && ` · 同步于 ${formatDateTime(src.lastSyncedAt)}`}
                          </div>
                        </div>

                        <div className="flex items-center gap-1 shrink-0">
                          {src.kind === 'subscription' && (
                            <button
                              type="button"
                              onClick={() => handleSync(src.id)}
                              disabled={syncingId === src.id}
                              className="p-1.5 rounded border border-[#E5E7EB] hover:bg-[#F7F7F8] dark:border-[#242429] dark:hover:bg-[#1C1C21]"
                              title="立即同步"
                            >
                              <RefreshCw
                                className={`w-3.5 h-3.5 ${syncingId === src.id ? 'animate-spin text-[#EA580C]' : ''}`}
                              />
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => startEdit(src)}
                            className="p-1.5 rounded border border-[#E5E7EB] hover:bg-[#F7F7F8] dark:border-[#242429] dark:hover:bg-[#1C1C21]"
                            title="编辑"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={async () => {
                              try {
                                await api.updateSource(src.id, { enabled: !src.enabled });
                                await onRefresh();
                              } catch (err) {
                                onNotify(err instanceof Error ? err.message : '切换失败', true);
                              }
                            }}
                            className="p-1.5 rounded border border-[#E5E7EB] hover:bg-[#F7F7F8] dark:border-[#242429] dark:hover:bg-[#1C1C21]"
                            title={src.enabled ? '禁用该来源' : '启用该来源'}
                          >
                            <Power
                              className={`w-3.5 h-3.5 ${src.enabled ? 'text-[#0A0A0A] dark:text-[#FAFAFA]' : 'text-[#9CA3AF]'}`}
                            />
                          </button>
                          <button
                            type="button"
                            onClick={async () => {
                              if (!window.confirm(`删除来源「${src.name}」及其所有节点？`)) return;
                              try {
                                await api.deleteSource(src.id);
                                await onRefresh();
                                onNotify('来源已删除');
                              } catch (err) {
                                onNotify(err instanceof Error ? err.message : '删除失败', true);
                              }
                            }}
                            className="p-1.5 rounded border border-[#E5E7EB] hover:text-[#EA580C] dark:border-[#242429]"
                            title="删除来源"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      {total > 0 && (
                        <div className="mt-3 pt-3 border-t border-[#E5E7EB] dark:border-[#242429]">
                          <div className="flex items-center justify-between text-[11px] tabular-mono mb-1.5">
                            <span>
                              已用 {formatBytes(used)} / {formatBytes(total)} ({pct}%)
                            </span>
                            <span className="text-[#6B7280] dark:text-[#9CA3AF]">
                              {src.expireAt ? `到期 ${formatDateOnly(src.expireAt)}` : '无到期信息'}
                            </span>
                          </div>
                          <div className="h-1.5 w-full rounded-full bg-[#E5E7EB] dark:bg-[#242429] overflow-hidden">
                            <div
                              className="h-full bg-[#EA580C] dark:bg-[#F97316]"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                      )}

                      {src.lastError && (
                        <div className="mt-2.5 rounded border border-[#EA580C]/40 bg-[#EA580C]/10 px-2.5 py-1.5 text-[11px] text-[#EA580C] dark:text-[#F97316]">
                          最近错误：{src.lastError}
                        </div>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Manual Node Import & Form */}
      <section className="rounded-lg border border-[#E5E7EB] bg-[#FFFFFF] dark:border-[#242429] dark:bg-[#141417] overflow-hidden">
        <div className="px-4 py-3 border-b border-[#E5E7EB] dark:border-[#242429] flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold">导入或手工新增自有节点</h2>
            <p className="text-xs text-[#6B7280] dark:text-[#9CA3AF]">
              支持粘贴多行分享链接 / Surge [Proxy] / Clash YAML，或通过表单录入自建节点。
            </p>
          </div>
          <div className="inline-flex rounded border border-[#E5E7EB] bg-[#F7F7F8] p-0.5 dark:border-[#242429] dark:bg-[#0A0A0B]">
            <button
              type="button"
              onClick={() => setManualTab('paste')}
              className={`px-2.5 py-1 rounded text-xs font-medium inline-flex items-center gap-1 ${
                manualTab === 'paste'
                  ? 'bg-[#0A0A0A] text-[#FFFFFF] dark:bg-[#FAFAFA] dark:text-[#0A0A0B]'
                  : 'text-[#6B7280] dark:text-[#9CA3AF]'
              }`}
            >
              <FileText className="w-3.5 h-3.5" /> 粘贴导入
            </button>
            <button
              type="button"
              onClick={() => setManualTab('form')}
              className={`px-2.5 py-1 rounded text-xs font-medium inline-flex items-center gap-1 ${
                manualTab === 'form'
                  ? 'bg-[#0A0A0A] text-[#FFFFFF] dark:bg-[#FAFAFA] dark:text-[#0A0A0B]'
                  : 'text-[#6B7280] dark:text-[#9CA3AF]'
              }`}
            >
              <Server className="w-3.5 h-3.5" /> 表单新增
            </button>
          </div>
        </div>

        <div className="p-4">
          {manualTab === 'paste' ? (
            <form onSubmit={handleImportPaste} className="space-y-3">
              <textarea
                rows={5}
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                placeholder={`粘贴节点 URI（ss:// vmess:// vless:// trojan:// hysteria2:// tuic:// wireguard:// anytls://）\n或 Surge [Proxy] 节点行（如：JP-Snell = snell, example.com, 443, psk=..., version=4）`}
                className="w-full rounded border border-[#E5E7EB] bg-[#F7F7F8] p-3 text-xs tabular-mono outline-none focus:border-[#EA580C] dark:border-[#242429] dark:bg-[#0A0A0B] dark:focus:border-[#F97316]"
              />
              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={importingText || !pasteText.trim()}
                  className="h-8 rounded bg-[#EA580C] px-4 text-xs font-medium text-[#FFFFFF] hover:bg-[#C2410C] disabled:opacity-50 dark:bg-[#F97316] dark:text-[#0A0A0B]"
                >
                  {importingText ? '解析导入中...' : '解析并导入自有节点'}
                </button>
              </div>
            </form>
          ) : (
            <form onSubmit={handleAddManualNode} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div>
                <label className="block text-[11px] text-[#6B7280] mb-1">节点名称 *</label>
                <input
                  type="text"
                  required
                  value={mName}
                  onChange={(e) => setMName(e.target.value)}
                  placeholder="🇯🇵 东京自建 Hy2"
                  className="w-full h-8 rounded border border-[#E5E7EB] bg-[#F7F7F8] px-2.5 text-xs dark:border-[#242429] dark:bg-[#0A0A0B]"
                />
              </div>
              <div>
                <label className="block text-[11px] text-[#6B7280] mb-1">协议 *</label>
                <select
                  value={mProto}
                  onChange={(e) => setMProto(e.target.value as ProxyProtocol)}
                  className="w-full h-8 rounded border border-[#E5E7EB] bg-[#F7F7F8] px-2.5 text-xs dark:border-[#242429] dark:bg-[#0A0A0B]"
                >
                  {MANUAL_PROTOCOLS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[11px] text-[#6B7280] mb-1">服务器地址 *</label>
                <input
                  type="text"
                  required
                  value={mHost}
                  onChange={(e) => setMHost(e.target.value)}
                  placeholder="node.example.com"
                  className="w-full h-8 rounded border border-[#E5E7EB] bg-[#F7F7F8] px-2.5 text-xs tabular-mono dark:border-[#242429] dark:bg-[#0A0A0B]"
                />
              </div>
              <div>
                <label className="block text-[11px] text-[#6B7280] mb-1">端口 *</label>
                <input
                  type="number"
                  required
                  min={1}
                  max={65535}
                  value={mPort}
                  onChange={(e) => setMPort(e.target.value)}
                  className="w-full h-8 rounded border border-[#E5E7EB] bg-[#F7F7F8] px-2.5 text-xs tabular-mono dark:border-[#242429] dark:bg-[#0A0A0B]"
                />
              </div>

              {['vmess', 'vless', 'tuic'].includes(mProto) && (
                <div>
                  <label className="block text-[11px] text-[#6B7280] mb-1">UUID</label>
                  <input
                    type="text"
                    value={mUuid}
                    onChange={(e) => setMUuid(e.target.value)}
                    className="w-full h-8 rounded border border-[#E5E7EB] bg-[#F7F7F8] px-2.5 text-xs tabular-mono dark:border-[#242429] dark:bg-[#0A0A0B]"
                  />
                </div>
              )}

              {['ss', 'trojan', 'hysteria2', 'tuic', 'snell', 'anytls'].includes(mProto) && (
                <div>
                  <label className="block text-[11px] text-[#6B7280] mb-1">
                    {mProto === 'snell' ? 'PSK 密钥' : '密码'}
                  </label>
                  <input
                    type="password"
                    value={mPassword}
                    onChange={(e) => setMPassword(e.target.value)}
                    className="w-full h-8 rounded border border-[#E5E7EB] bg-[#F7F7F8] px-2.5 text-xs tabular-mono dark:border-[#242429] dark:bg-[#0A0A0B]"
                  />
                </div>
              )}

              {mProto === 'ss' && (
                <div>
                  <label className="block text-[11px] text-[#6B7280] mb-1">加密算法</label>
                  <input
                    type="text"
                    value={mMethod}
                    onChange={(e) => setMMethod(e.target.value)}
                    placeholder="2022-blake3-aes-128-gcm"
                    className="w-full h-8 rounded border border-[#E5E7EB] bg-[#F7F7F8] px-2.5 text-xs tabular-mono dark:border-[#242429] dark:bg-[#0A0A0B]"
                  />
                </div>
              )}

              {mProto === 'snell' && (
                <div>
                  <label className="block text-[11px] text-[#6B7280] mb-1">Snell 版本</label>
                  <input
                    type="number"
                    value={mSnellVersion}
                    onChange={(e) => setMSnellVersion(e.target.value)}
                    className="w-full h-8 rounded border border-[#E5E7EB] bg-[#F7F7F8] px-2.5 text-xs tabular-mono dark:border-[#242429] dark:bg-[#0A0A0B]"
                  />
                </div>
              )}

              {['vless', 'trojan', 'hysteria2', 'tuic', 'anytls'].includes(mProto) && (
                <div>
                  <label className="block text-[11px] text-[#6B7280] mb-1">SNI 域名</label>
                  <input
                    type="text"
                    value={mSni}
                    onChange={(e) => setMSni(e.target.value)}
                    placeholder="可选"
                    className="w-full h-8 rounded border border-[#E5E7EB] bg-[#F7F7F8] px-2.5 text-xs tabular-mono dark:border-[#242429] dark:bg-[#0A0A0B]"
                  />
                </div>
              )}

              {mProto === 'hysteria2' && (
                <>
                  <div>
                    <label className="block text-[11px] text-[#6B7280] mb-1">pinSHA256 证书指纹</label>
                    <input
                      type="text"
                      value={mPinSha256}
                      onChange={(e) => setMPinSha256(e.target.value)}
                      placeholder="64 位 hex（可选）"
                      className="w-full h-8 rounded border border-[#E5E7EB] bg-[#F7F7F8] px-2.5 text-xs tabular-mono dark:border-[#242429] dark:bg-[#0A0A0B]"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-[#6B7280] mb-1">端口跳跃 (mport)</label>
                    <input
                      type="text"
                      value={mPortHopping}
                      onChange={(e) => setMPortHopping(e.target.value)}
                      placeholder="如 20000-50000"
                      className="w-full h-8 rounded border border-[#E5E7EB] bg-[#F7F7F8] px-2.5 text-xs tabular-mono dark:border-[#242429] dark:bg-[#0A0A0B]"
                    />
                  </div>
                </>
              )}

              {['ss', 'snell'].includes(mProto) && (
                <>
                  <div>
                    <label className="block text-[11px] text-[#6B7280] mb-1">ShadowTLS v3 密码（可选）</label>
                    <input
                      type="password"
                      value={mShadowTlsPass}
                      onChange={(e) => setMShadowTlsPass(e.target.value)}
                      className="w-full h-8 rounded border border-[#E5E7EB] bg-[#F7F7F8] px-2.5 text-xs tabular-mono dark:border-[#242429] dark:bg-[#0A0A0B]"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-[#6B7280] mb-1">ShadowTLS SNI（可选）</label>
                    <input
                      type="text"
                      value={mShadowTlsSni}
                      onChange={(e) => setMShadowTlsSni(e.target.value)}
                      placeholder="gateway.icloud.com"
                      className="w-full h-8 rounded border border-[#E5E7EB] bg-[#F7F7F8] px-2.5 text-xs tabular-mono dark:border-[#242429] dark:bg-[#0A0A0B]"
                    />
                  </div>
                </>
              )}

              {mProto === 'wireguard' && (
                <>
                  <div>
                    <label className="block text-[11px] text-[#6B7280] mb-1">Private Key</label>
                    <input
                      type="password"
                      value={mWgPrivateKey}
                      onChange={(e) => setMWgPrivateKey(e.target.value)}
                      className="w-full h-8 rounded border border-[#E5E7EB] bg-[#F7F7F8] px-2.5 text-xs tabular-mono dark:border-[#242429] dark:bg-[#0A0A0B]"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-[#6B7280] mb-1">Peer Public Key</label>
                    <input
                      type="text"
                      value={mWgPublicKey}
                      onChange={(e) => setMWgPublicKey(e.target.value)}
                      className="w-full h-8 rounded border border-[#E5E7EB] bg-[#F7F7F8] px-2.5 text-xs tabular-mono dark:border-[#242429] dark:bg-[#0A0A0B]"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-[#6B7280] mb-1">Self IP</label>
                    <input
                      type="text"
                      value={mWgSelfIp}
                      onChange={(e) => setMWgSelfIp(e.target.value)}
                      className="w-full h-8 rounded border border-[#E5E7EB] bg-[#F7F7F8] px-2.5 text-xs tabular-mono dark:border-[#242429] dark:bg-[#0A0A0B]"
                    />
                  </div>
                </>
              )}

              <div className="sm:col-span-2 lg:col-span-4 flex flex-wrap items-center justify-between gap-2 pt-1">
                <label className="inline-flex items-center gap-2 text-xs text-[#6B7280] dark:text-[#9CA3AF]">
                  <input
                    type="checkbox"
                    checked={mSkipVerify}
                    onChange={(e) => setMSkipVerify(e.target.checked)}
                    className="accent-[#EA580C]"
                  />
                  跳过 TLS 证书校验（使用 pinSHA256 时无需勾选）
                </label>
                <button
                  type="submit"
                  disabled={addingManual}
                  className="h-8 rounded bg-[#EA580C] px-4 text-xs font-medium text-[#FFFFFF] hover:bg-[#C2410C] disabled:opacity-50 dark:bg-[#F97316] dark:text-[#0A0A0B]"
                >
                  {addingManual ? '保存中...' : '添加自有节点'}
                </button>
              </div>
            </form>
          )}
        </div>
      </section>
    </div>
  );
}
