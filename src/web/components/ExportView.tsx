import React, { useEffect, useState } from 'react';
import {
  Copy,
  Download,
  Eye,
  EyeOff,
  ExternalLink,
  Plus,
  QrCode,
  RotateCw,
  Trash2,
  Power,
  AlertTriangle,
  CheckCircle2,
  X,
} from 'lucide-react';
import { CLIENTS, CLIENT_MAP, buildClientImportUrl } from '../../shared/clients.js';
import type {
  ClientTarget,
  ExportMode,
  ExportPreviewResult,
  SourceRecord,
} from '../../shared/types.js';
import { api, type ChannelWithUrl } from '../api.js';
import { copyToClipboard, downloadTextFile, formatDateTime } from '../utils.js';

interface ExportViewProps {
  channels: ChannelWithUrl[];
  sources: SourceRecord[];
  onRefresh: () => Promise<void>;
  onNotify: (msg: string, isError?: boolean) => void;
}

export function ExportView({ channels, sources, onRefresh, onNotify }: ExportViewProps) {
  const [selectedClient, setSelectedClient] = useState<ClientTarget>('surge');
  const [selectedMode, setSelectedMode] = useState<ExportMode>('full');
  const [masked, setMasked] = useState(true);
  const [previewChannelId, setPreviewChannelId] = useState<string | undefined>(undefined);
  const [preview, setPreview] = useState<ExportPreviewResult | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [showSkippedDetails, setShowSkippedDetails] = useState(false);

  // New channel form
  const [chName, setChName] = useState('');
  const [chClient, setChClient] = useState<ClientTarget>('surge');
  const [chMode, setChMode] = useState<ExportMode>('full');
  const [chSourceId, setChSourceId] = useState<string>('ALL');
  const [creatingChannel, setCreatingChannel] = useState(false);

  // QR modal
  const [qrModal, setQrModal] = useState<{ title: string; url: string; dataUrl: string } | null>(
    null,
  );

  const clientMeta = CLIENT_MAP[selectedClient];

  useEffect(() => {
    if (!clientMeta.supportsModes.includes(selectedMode)) {
      setSelectedMode(clientMeta.defaultMode);
    }
  }, [selectedClient, clientMeta, selectedMode]);

  useEffect(() => {
    let cancelled = false;
    async function loadPreview() {
      setLoadingPreview(true);
      try {
        const modeToUse = clientMeta.supportsModes.includes(selectedMode)
          ? selectedMode
          : clientMeta.defaultMode;
        const data = await api.previewExport({
          client: selectedClient,
          mode: modeToUse,
          masked,
          channelId: previewChannelId,
        });
        if (!cancelled) setPreview(data);
      } catch (err) {
        if (!cancelled) {
          onNotify(err instanceof Error ? err.message : '生成配置预览失败', true);
        }
      } finally {
        if (!cancelled) setLoadingPreview(false);
      }
    }
    loadPreview();
    return () => {
      cancelled = true;
    };
  }, [selectedClient, selectedMode, masked, previewChannelId]);

  async function handleCreateChannel(e: React.FormEvent) {
    e.preventDefault();
    const name = chName.trim() || `${CLIENT_MAP[chClient].shortName} 订阅`;
    setCreatingChannel(true);
    try {
      const meta = CLIENT_MAP[chClient];
      const mode = meta.supportsModes.includes(chMode) ? chMode : meta.defaultMode;
      await api.createChannel({
        name,
        client: chClient,
        mode,
        sourceIds: chSourceId === 'ALL' ? [] : [chSourceId],
        excludeBlocked: true,
      });
      setChName('');
      await onRefresh();
      onNotify(`已创建托管通道「${name}」`);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : '创建失败', true);
    } finally {
      setCreatingChannel(false);
    }
  }

  async function openQrModal(ch: ChannelWithUrl) {
    try {
      const res = await api.generateQrCode(ch.subscribeUrl);
      setQrModal({ title: `${ch.name} (${ch.client})`, url: ch.subscribeUrl, dataUrl: res.dataUrl });
    } catch (err) {
      onNotify(err instanceof Error ? err.message : '二维码生成失败', true);
    }
  }

  return (
    <div className="space-y-5">
      {/* Hosted Subscription Channels */}
      <section className="rounded-lg border border-[#E5E7EB] bg-[#FFFFFF] dark:border-[#242429] dark:bg-[#141417] overflow-hidden">
        <div className="px-4 py-3 border-b border-[#E5E7EB] dark:border-[#242429]">
          <h2 className="text-sm font-semibold">托管订阅通道（独立 Token 隔离）</h2>
          <p className="text-xs text-[#6B7280] dark:text-[#9CA3AF]">
            每个通道生成带客户端标识的独立托管链接（如 <code className="tabular-mono">/sub/surge/...</code>、
            <code className="tabular-mono">/sub/clash/...</code>），供客户端定时静默拉取，随时可轮换或停用。
          </p>
        </div>

        {/* Create channel form */}
        <form
          onSubmit={handleCreateChannel}
          className="p-4 bg-[#F7F7F8] dark:bg-[#0F0F12] border-b border-[#E5E7EB] dark:border-[#242429] grid grid-cols-1 md:grid-cols-12 gap-2.5"
        >
          <input
            type="text"
            value={chName}
            onChange={(e) => setChName(e.target.value)}
            placeholder="通道名称（如：主力 iPhone Surge）"
            className="md:col-span-3 h-9 rounded border border-[#E5E7EB] bg-[#FFFFFF] px-3 text-xs outline-none focus:border-[#EA580C] dark:border-[#242429] dark:bg-[#0A0A0B] dark:focus:border-[#F97316]"
          />
          <select
            value={chClient}
            onChange={(e) => {
              const next = e.target.value as ClientTarget;
              setChClient(next);
              setChMode(CLIENT_MAP[next].defaultMode);
            }}
            className="md:col-span-3 h-9 rounded border border-[#E5E7EB] bg-[#FFFFFF] px-2.5 text-xs dark:border-[#242429] dark:bg-[#0A0A0B]"
          >
            {CLIENTS.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} (/sub/{c.id}/...)
              </option>
            ))}
          </select>
          <select
            value={chMode}
            onChange={(e) => setChMode(e.target.value as ExportMode)}
            className="md:col-span-2 h-9 rounded border border-[#E5E7EB] bg-[#FFFFFF] px-2.5 text-xs dark:border-[#242429] dark:bg-[#0A0A0B]"
          >
            {CLIENT_MAP[chClient].supportsModes.map((m) => (
              <option key={m} value={m}>
                {m === 'full' ? '完整配置 (full)' : '仅节点 (nodes)'}
              </option>
            ))}
          </select>
          <select
            value={chSourceId}
            onChange={(e) => setChSourceId(e.target.value)}
            className="md:col-span-2 h-9 rounded border border-[#E5E7EB] bg-[#FFFFFF] px-2.5 text-xs dark:border-[#242429] dark:bg-[#0A0A0B]"
          >
            <option value="ALL">聚合全部来源</option>
            {sources.map((s) => (
              <option key={s.id} value={s.id}>
                仅 {s.name}
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={creatingChannel}
            className="md:col-span-2 h-9 rounded bg-[#EA580C] text-[#FFFFFF] text-xs font-medium inline-flex items-center justify-center gap-1.5 hover:bg-[#C2410C] disabled:opacity-50 dark:bg-[#F97316] dark:text-[#0A0A0B]"
          >
            <Plus className="w-3.5 h-3.5" />
            {creatingChannel ? '创建中...' : '创建托管链接'}
          </button>
        </form>

        {/* Channel List */}
        <div className="divide-y divide-[#E5E7EB] dark:divide-[#242429]">
          {channels.length === 0 ? (
            <div className="p-8 text-center text-xs text-[#6B7280] dark:text-[#9CA3AF]">
              尚未创建托管通道。在上方选择目标客户端即可生成专属托管链接与一键导入按钮。
            </div>
          ) : (
            channels.map((ch) => {
              const meta = CLIENT_MAP[ch.client];
              const importUrl = buildClientImportUrl(ch.client, ch.subscribeUrl, ch.name);
              return (
                <div
                  key={ch.id}
                  className={`p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3 ${
                    !ch.enabled ? 'opacity-55' : ''
                  }`}
                >
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-sm">{ch.name}</span>
                      <span className="tabular-mono rounded border border-[#EA580C]/40 bg-[#EA580C]/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-[#EA580C] dark:text-[#F97316]">
                        {ch.client}
                      </span>
                      <span className="tabular-mono rounded border border-[#E5E7EB] bg-[#F7F7F8] px-1.5 py-0.5 text-[10px] text-[#6B7280] dark:border-[#242429] dark:bg-[#0A0A0B] dark:text-[#9CA3AF]">
                        {ch.mode === 'full' ? '完整配置' : '仅节点'}
                      </span>
                      {!ch.enabled && (
                        <span className="rounded border border-[#E5E7EB] px-1.5 py-0.5 text-[10px] text-[#6B7280]">
                          已停用
                        </span>
                      )}
                      <span className="tabular-mono text-[11px] text-[#6B7280] dark:text-[#9CA3AF]">
                        拉取 {ch.accessCount} 次
                        {ch.lastAccessedAt ? ` · 最近 ${formatDateTime(ch.lastAccessedAt)}` : ''}
                      </span>
                    </div>
                    <div className="tabular-mono text-[11px] text-[#6B7280] dark:text-[#9CA3AF] bg-[#F7F7F8] dark:bg-[#0A0A0B] border border-[#E5E7EB] dark:border-[#242429] rounded px-2.5 py-1.5 truncate">
                      {ch.subscribeUrl}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={async () => {
                        await copyToClipboard(ch.subscribeUrl);
                        onNotify(`已复制 ${meta.shortName} 托管链接`);
                      }}
                      className="h-8 rounded border border-[#E5E7EB] bg-[#FFFFFF] px-2.5 text-xs font-medium inline-flex items-center gap-1 hover:bg-[#F7F7F8] dark:border-[#242429] dark:bg-[#0A0A0B]"
                    >
                      <Copy className="w-3.5 h-3.5" /> 复制
                    </button>
                    <button
                      type="button"
                      onClick={() => openQrModal(ch)}
                      className="h-8 rounded border border-[#E5E7EB] bg-[#FFFFFF] px-2.5 text-xs font-medium inline-flex items-center gap-1 hover:bg-[#F7F7F8] dark:border-[#242429] dark:bg-[#0A0A0B]"
                      title="显示二维码"
                    >
                      <QrCode className="w-3.5 h-3.5" /> 二维码
                    </button>
                    {importUrl && (
                      <a
                        href={importUrl}
                        className="h-8 rounded bg-[#EA580C] text-[#FFFFFF] px-2.5 text-xs font-medium inline-flex items-center gap-1 hover:bg-[#C2410C] dark:bg-[#F97316] dark:text-[#0A0A0B]"
                      >
                        <ExternalLink className="w-3.5 h-3.5" /> 一键导入
                      </a>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedClient(ch.client);
                        setSelectedMode(ch.mode);
                        setPreviewChannelId(ch.id);
                      }}
                      className="h-8 rounded border border-[#E5E7EB] px-2.5 text-xs hover:bg-[#F7F7F8] dark:border-[#242429]"
                    >
                      预览
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        if (!window.confirm('轮换后旧链接将立即失效，客户端需重新导入，确定继续？')) {
                          return;
                        }
                        try {
                          await api.rotateChannel(ch.id);
                          await onRefresh();
                          onNotify('Token 已轮换，旧链接已失效');
                        } catch (err) {
                          onNotify(err instanceof Error ? err.message : '轮换失败', true);
                        }
                      }}
                      className="p-2 rounded border border-[#E5E7EB] hover:bg-[#F7F7F8] dark:border-[#242429]"
                      title="轮换随机 Token"
                    >
                      <RotateCw className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          await api.updateChannel(ch.id, { enabled: !ch.enabled });
                          await onRefresh();
                        } catch (err) {
                          onNotify(err instanceof Error ? err.message : '切换失败', true);
                        }
                      }}
                      className="p-2 rounded border border-[#E5E7EB] hover:bg-[#F7F7F8] dark:border-[#242429]"
                      title={ch.enabled ? '停用链接' : '启用链接'}
                    >
                      <Power className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        if (!window.confirm(`删除托管通道「${ch.name}」？`)) return;
                        try {
                          await api.deleteChannel(ch.id);
                          if (previewChannelId === ch.id) setPreviewChannelId(undefined);
                          await onRefresh();
                          onNotify('托管通道已删除');
                        } catch (err) {
                          onNotify(err instanceof Error ? err.message : '删除失败', true);
                        }
                      }}
                      className="p-2 rounded border border-[#E5E7EB] hover:text-[#EA580C] dark:border-[#242429]"
                      title="删除通道"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </section>

      {/* Client Preview & Compatibility Matrix */}
      <section className="rounded-lg border border-[#E5E7EB] bg-[#FFFFFF] dark:border-[#242429] dark:bg-[#141417] overflow-hidden">
        <div className="p-4 border-b border-[#E5E7EB] dark:border-[#242429] space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold">多客户端兼容检查与在线预览</h2>
              <p className="text-xs text-[#6B7280] dark:text-[#9CA3AF]">
                严格按目标客户端协议能力矩阵过滤无法无损表达的节点，绝不静默输出不可用节点。
              </p>
            </div>
            <div className="flex items-center gap-2">
              {clientMeta.supportsModes.length > 1 && (
                <div className="inline-flex rounded border border-[#E5E7EB] bg-[#F7F7F8] p-0.5 dark:border-[#242429] dark:bg-[#0A0A0B]">
                  {clientMeta.supportsModes.map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setSelectedMode(m)}
                      className={`px-2.5 py-1 rounded text-xs font-medium ${
                        selectedMode === m
                          ? 'bg-[#0A0A0A] text-[#FFFFFF] dark:bg-[#FAFAFA] dark:text-[#0A0A0B]'
                          : 'text-[#6B7280]'
                      }`}
                    >
                      {m === 'full' ? '完整配置' : '仅节点'}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* 9 Clients Pills */}
          <div className="flex flex-wrap gap-1.5">
            {CLIENTS.map((c) => {
              const active = selectedClient === c.id;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => {
                    setSelectedClient(c.id);
                    setPreviewChannelId(undefined);
                  }}
                  className={`h-8 rounded border px-3 text-xs font-medium transition-colors ${
                    active
                      ? 'border-[#EA580C] bg-[#EA580C] text-[#FFFFFF] dark:border-[#F97316] dark:bg-[#F97316] dark:text-[#0A0A0B]'
                      : 'border-[#E5E7EB] bg-[#F7F7F8] text-[#0A0A0A] hover:border-[#D1D5DB] dark:border-[#242429] dark:bg-[#0A0A0B] dark:text-[#FAFAFA]'
                  }`}
                >
                  {c.shortName}
                </button>
              );
            })}
          </div>
          <div className="text-[11px] text-[#6B7280] dark:text-[#9CA3AF]">
            <strong className="text-[#0A0A0A] dark:text-[#FAFAFA]">{clientMeta.name}</strong>：
            {clientMeta.notes}
          </div>
        </div>

        {/* Compatibility Report Strip */}
        {preview && (
          <div className="px-4 py-2.5 border-b border-[#E5E7EB] bg-[#F7F7F8] dark:border-[#242429] dark:bg-[#0F0F12]">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex flex-wrap items-center gap-3 tabular-mono">
                <span className="inline-flex items-center gap-1.5 font-semibold">
                  <CheckCircle2 className="w-3.5 h-3.5 text-[#0A0A0A] dark:text-[#FAFAFA]" />
                  兼容 {preview.report.compatibleCount}
                </span>
                <span className="text-[#9CA3AF]">/</span>
                <span
                  className={`inline-flex items-center gap-1.5 font-semibold ${
                    preview.report.skippedCount > 0 ? 'text-[#EA580C] dark:text-[#F97316]' : 'text-[#6B7280]'
                  }`}
                >
                  {preview.report.skippedCount > 0 && <AlertTriangle className="w-3.5 h-3.5" />}
                  跳过 {preview.report.skippedCount}
                </span>
                <span className="text-[#6B7280]">(候选共 {preview.report.totalCandidates})</span>
              </div>

              {preview.report.skippedCount > 0 && (
                <button
                  type="button"
                  onClick={() => setShowSkippedDetails((v) => !v)}
                  className="text-xs font-medium text-[#EA580C] hover:underline dark:text-[#F97316]"
                >
                  {showSkippedDetails ? '收起跳过明细' : '查看跳过原因明细'}
                </button>
              )}
            </div>

            {showSkippedDetails && preview.report.skippedCount > 0 && (
              <div className="mt-2.5 pt-2.5 border-t border-[#E5E7EB] dark:border-[#242429] space-y-1.5">
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(preview.report.skippedByReason).map(([reason, cnt]) => (
                    <span
                      key={reason}
                      className="rounded border border-[#EA580C]/30 bg-[#EA580C]/10 px-2 py-0.5 text-[11px] text-[#EA580C] dark:text-[#F97316]"
                    >
                      {reason} × <span className="tabular-mono">{cnt}</span>
                    </span>
                  ))}
                </div>
                <div className="max-h-32 overflow-y-auto text-[11px] text-[#6B7280] dark:text-[#9CA3AF] space-y-0.5">
                  {preview.report.skipped.map((item) => (
                    <div key={item.nodeId} className="tabular-mono">
                      [{item.protocol}] {item.nodeName} — {item.reason}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Config Preview Toolbar & Code */}
        <div className="px-4 py-2 border-b border-[#E5E7EB] dark:border-[#242429] flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2">
            <span className="tabular-mono font-medium">{preview?.filename ?? 'config'}</span>
            <span
              className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                masked
                  ? 'bg-[#0A0A0A] text-[#FFFFFF] dark:bg-[#FAFAFA] dark:text-[#0A0A0B]'
                  : 'bg-[#EA580C]/15 text-[#EA580C] dark:text-[#F97316]'
              }`}
            >
              {masked ? '凭据已打码' : '明文预览'}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setMasked((v) => !v)}
              className="h-7 rounded border border-[#E5E7EB] px-2.5 text-xs inline-flex items-center gap-1 hover:bg-[#F7F7F8] dark:border-[#242429] dark:hover:bg-[#1C1C21]"
            >
              {masked ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
              {masked ? '显示明文' : '隐藏凭据'}
            </button>
            <button
              type="button"
              disabled={!preview}
              onClick={async () => {
                if (!preview) return;
                await copyToClipboard(preview.content);
                onNotify('已复制预览配置内容');
              }}
              className="h-7 rounded border border-[#E5E7EB] px-2.5 text-xs inline-flex items-center gap-1 hover:bg-[#F7F7F8] disabled:opacity-40 dark:border-[#242429]"
            >
              <Copy className="w-3.5 h-3.5" /> 复制文本
            </button>
            <button
              type="button"
              disabled={!preview}
              onClick={async () => {
                if (!preview) return;
                const raw = masked
                  ? await api.previewExport({
                      client: selectedClient,
                      mode: selectedMode,
                      masked: false,
                      channelId: previewChannelId,
                    })
                  : preview;
                downloadTextFile(raw.filename, raw.content, raw.contentType);
                onNotify(`已下载 ${raw.filename}`);
              }}
              className="h-7 rounded bg-[#0A0A0A] text-[#FFFFFF] px-2.5 text-xs inline-flex items-center gap-1 dark:bg-[#FAFAFA] dark:text-[#0A0A0B]"
            >
              <Download className="w-3.5 h-3.5" /> 下载文件
            </button>
          </div>
        </div>

        <pre className="p-4 text-[11.5px] leading-relaxed tabular-mono overflow-x-auto max-h-[420px] bg-[#F7F7F8] dark:bg-[#0A0A0B] text-[#0A0A0A] dark:text-[#E5E7EB] m-0">
          {loadingPreview ? '正在生成配置预览...' : preview?.content || '# 暂无可用节点'}
        </pre>
      </section>

      {/* QR Modal */}
      {qrModal && (
        <div
          className="fixed inset-0 z-50 bg-black/50 grid place-items-center p-4"
          onClick={() => setQrModal(null)}
        >
          <div
            className="w-full max-w-xs rounded-lg border border-[#E5E7EB] bg-[#FFFFFF] p-5 dark:border-[#242429] dark:bg-[#141417]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold truncate">{qrModal.title}</h3>
              <button
                type="button"
                onClick={() => setQrModal(null)}
                className="p-1 text-[#6B7280] hover:text-[#0A0A0A] dark:hover:text-[#FAFAFA]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="rounded border border-[#E5E7EB] bg-[#FFFFFF] p-3 grid place-items-center">
              <img src={qrModal.dataUrl} alt="托管订阅二维码" className="w-48 h-48" />
            </div>
            <p className="mt-3 tabular-mono text-[10px] text-[#6B7280] break-all">{qrModal.url}</p>
          </div>
        </div>
      )}
    </div>
  );
}
