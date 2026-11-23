import React, { useCallback, useEffect, useState } from 'react';
import {
  Globe2,
  Layers,
  KeyRound,
  LogOut,
  Moon,
  Radio,
  Share2,
  Sun,
  X,
} from 'lucide-react';
import type {
  NodeRecord,
  RoutingProfile,
  SecurityStatus,
  SourceRecord,
} from '../shared/types.js';
import { api, type ChannelWithUrl, type OverviewStats } from './api.js';
import { AuthGate } from './components/AuthGate.js';
import { ExportView } from './components/ExportView.js';
import { NodesView } from './components/NodesView.js';
import { RulesView } from './components/RulesView.js';
import { SourcesView } from './components/SourcesView.js';
import { TowerMark } from './components/TowerMark.js';

type TabId = 'nodes' | 'sources' | 'rules' | 'export';

const TABS: Array<{ id: TabId; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: 'nodes', label: '节点与地图', icon: Globe2 },
  { id: 'sources', label: '订阅与节点', icon: Radio },
  { id: 'rules', label: '规则与策略', icon: Layers },
  { id: 'export', label: '导出与托管', icon: Share2 },
];

export function App() {
  const [dark, setDark] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem('tower-theme') === 'dark';
  });
  const [authStatus, setAuthStatus] = useState<SecurityStatus | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>('nodes');

  // Core workspace data
  const [overview, setOverview] = useState<OverviewStats | null>(null);
  const [sources, setSources] = useState<SourceRecord[]>([]);
  const [nodes, setNodes] = useState<NodeRecord[]>([]);
  const [profile, setProfile] = useState<RoutingProfile | null>(null);
  const [channels, setChannels] = useState<ChannelWithUrl[]>([]);

  // Toast & password modal
  const [toast, setToast] = useState<{ msg: string; isError: boolean } | null>(null);
  const [pwdModalOpen, setPwdModalOpen] = useState(false);
  const [curPwd, setCurPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    window.localStorage.setItem('tower-theme', dark ? 'dark' : 'light');
  }, [dark]);

  const notify = useCallback((msg: string, isError = false) => {
    setToast({ msg, isError });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3400);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const checkAuth = useCallback(async () => {
    try {
      const status = await api.authStatus();
      setAuthStatus(status);
    } catch (err) {
      notify(err instanceof Error ? err.message : '无法连接 Tower 服务', true);
    }
  }, [notify]);

  const loadAllData = useCallback(async () => {
    try {
      const [ov, srcRes, nodeRes, routeRes, chRes] = await Promise.all([
        api.getOverview(),
        api.listSources(),
        api.listNodes(),
        api.getRouting(),
        api.listChannels(),
      ]);
      setOverview(ov);
      setSources(srcRes.sources);
      setNodes(nodeRes.nodes);
      setProfile(routeRes.profile);
      setChannels(chRes.channels);
    } catch (err) {
      notify(err instanceof Error ? err.message : '加载数据失败', true);
    }
  }, [notify]);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  useEffect(() => {
    if (authStatus?.authenticated) {
      loadAllData();
    }
  }, [authStatus?.authenticated, loadAllData]);

  async function handleLogout() {
    await api.authLogout();
    await checkAuth();
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api.authChangePassword(curPwd, newPwd);
      setPwdModalOpen(false);
      setCurPwd('');
      setNewPwd('');
      notify('管理员密码已更新');
    } catch (err) {
      notify(err instanceof Error ? err.message : '修改密码失败', true);
    }
  }

  if (!authStatus) {
    return (
      <div className="min-h-screen grid place-items-center bg-[#FFFFFF] text-[#6B7280] dark:bg-[#0A0A0B] text-xs tabular-mono">
        TOWER · INITIALIZING...
      </div>
    );
  }

  if (!authStatus.authenticated) {
    return (
      <AuthGate
        status={authStatus}
        dark={dark}
        onToggleTheme={() => setDark((d) => !d)}
        onAuthenticated={checkAuth}
      />
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-[#FFFFFF] text-[#0A0A0A] dark:bg-[#0A0A0B] dark:text-[#FAFAFA]">
      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-[#E5E7EB] bg-[#FFFFFF]/95 backdrop-blur dark:border-[#242429] dark:bg-[#0A0A0B]/95">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 shrink-0">
            <TowerMark className="h-8 w-8 shrink-0" />
            <span className="font-bold tracking-[0.14em] text-sm">TOWER</span>
            <span className="hidden sm:inline text-xs text-[#6B7280] dark:text-[#9CA3AF] border-l border-[#E5E7EB] dark:border-[#242429] pl-2.5">
              塔台
            </span>
          </div>

          {/* Desktop Nav */}
          <nav className="hidden md:flex items-stretch h-14 gap-1">
            {TABS.map((tab) => {
              const Icon = tab.icon;
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`relative px-3.5 text-xs font-medium inline-flex items-center gap-1.5 transition-colors ${
                    active
                      ? 'text-[#0A0A0A] dark:text-[#FAFAFA]'
                      : 'text-[#6B7280] hover:text-[#0A0A0A] dark:text-[#9CA3AF] dark:hover:text-[#FAFAFA]'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {tab.label}
                  {active && (
                    <span className="absolute inset-x-2 bottom-0 h-[2px] bg-[#EA580C] dark:bg-[#F97316]" />
                  )}
                </button>
              );
            })}
          </nav>

          {/* Right Actions */}
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setDark((d) => !d)}
              className="h-8 w-8 rounded border border-[#E5E7EB] dark:border-[#242429] grid place-items-center text-[#6B7280] hover:text-[#0A0A0A] dark:hover:text-[#FAFAFA]"
              title="切换浅色/深色模式"
            >
              {dark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
            {!authStatus.adminPasswordExternal && (
              <button
                type="button"
                onClick={() => setPwdModalOpen(true)}
                className="h-8 w-8 rounded border border-[#E5E7EB] dark:border-[#242429] grid place-items-center text-[#6B7280] hover:text-[#0A0A0A] dark:hover:text-[#FAFAFA]"
                title="修改管理员密码"
              >
                <KeyRound className="w-4 h-4" />
              </button>
            )}
            <button
              type="button"
              onClick={handleLogout}
              className="h-8 px-2.5 rounded border border-[#E5E7EB] dark:border-[#242429] text-xs text-[#6B7280] hover:text-[#0A0A0A] dark:hover:text-[#FAFAFA] inline-flex items-center gap-1"
              title="退出登录"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">退出</span>
            </button>
          </div>
        </div>

        {/* Mobile Scrollable Tab Bar */}
        <div className="md:hidden border-t border-[#E5E7EB] dark:border-[#242429] flex overflow-x-auto px-2">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`relative flex-1 min-w-[84px] py-2.5 text-xs font-medium inline-flex items-center justify-center gap-1 whitespace-nowrap ${
                  active
                    ? 'text-[#0A0A0A] dark:text-[#FAFAFA]'
                    : 'text-[#6B7280] dark:text-[#9CA3AF]'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {tab.label}
                {active && (
                  <span className="absolute inset-x-2 bottom-0 h-[2px] bg-[#EA580C] dark:bg-[#F97316]" />
                )}
              </button>
            );
          })}
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-5">
        {activeTab === 'nodes' && (
          <NodesView
            overview={overview}
            nodes={nodes}
            sources={sources}
            onRefresh={loadAllData}
            onNotify={notify}
          />
        )}
        {activeTab === 'sources' && (
          <SourcesView sources={sources} onRefresh={loadAllData} onNotify={notify} />
        )}
        {activeTab === 'rules' && (
          <RulesView profile={profile} onRefresh={loadAllData} onNotify={notify} />
        )}
        {activeTab === 'export' && (
          <ExportView
            channels={channels}
            sources={sources}
            onRefresh={loadAllData}
            onNotify={notify}
          />
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-[#E5E7EB] dark:border-[#242429] py-3.5 px-4 text-[11px] text-[#6B7280] dark:text-[#9CA3AF]">
        <div className="max-w-6xl mx-auto flex flex-wrap items-center justify-between gap-2">
          <span>Tower · 设计理念致敬 iOS 应用「塔台 · Tower」</span>
          <span className="tabular-mono">
            {authStatus.databaseDriver === 'postgres' ? 'PostgreSQL' : 'PGlite'} · 非商业开源协议
          </span>
        </div>
      </footer>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-4 right-4 z-50 max-w-sm rounded border border-[#E5E7EB] bg-[#0A0A0A] text-[#FFFFFF] px-3.5 py-2.5 text-xs shadow-sm dark:border-[#242429] dark:bg-[#FAFAFA] dark:text-[#0A0A0B] flex items-center gap-2">
          <span
            className={`w-2 h-2 rounded-full shrink-0 ${
              toast.isError ? 'bg-[#EA580C]' : 'bg-[#EA580C] dark:bg-[#F97316]'
            }`}
          />
          <span>{toast.msg}</span>
        </div>
      )}

      {/* Change Password Modal */}
      {pwdModalOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/50 grid place-items-center p-4"
          onClick={() => setPwdModalOpen(false)}
        >
          <div
            className="w-full max-w-sm rounded-lg border border-[#E5E7EB] bg-[#FFFFFF] p-5 dark:border-[#242429] dark:bg-[#141417]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold">修改管理员密码</h3>
              <button
                type="button"
                onClick={() => setPwdModalOpen(false)}
                className="p-1 text-[#6B7280]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleChangePassword} className="space-y-3">
              <div>
                <label className="block text-xs text-[#6B7280] mb-1">当前密码</label>
                <input
                  type="password"
                  required
                  value={curPwd}
                  onChange={(e) => setCurPwd(e.target.value)}
                  className="w-full h-9 rounded border border-[#E5E7EB] bg-[#F7F7F8] px-3 text-xs dark:border-[#242429] dark:bg-[#0A0A0B]"
                />
              </div>
              <div>
                <label className="block text-xs text-[#6B7280] mb-1">新密码（至少 8 位）</label>
                <input
                  type="password"
                  required
                  minLength={8}
                  value={newPwd}
                  onChange={(e) => setNewPwd(e.target.value)}
                  className="w-full h-9 rounded border border-[#E5E7EB] bg-[#F7F7F8] px-3 text-xs dark:border-[#242429] dark:bg-[#0A0A0B]"
                />
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setPwdModalOpen(false)}
                  className="h-8 rounded border border-[#E5E7EB] px-3 text-xs dark:border-[#242429]"
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="h-8 rounded bg-[#EA580C] text-[#FFFFFF] px-3 text-xs font-medium dark:bg-[#F97316] dark:text-[#0A0A0B]"
                >
                  更新密码
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
