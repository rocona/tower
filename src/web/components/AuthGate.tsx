import React, { useState } from 'react';
import { Lock, ShieldCheck, Moon, Sun } from 'lucide-react';
import type { SecurityStatus } from '../../shared/types.js';
import { api } from '../api.js';
import { TowerMark } from './TowerMark.js';

interface AuthGateProps {
  status: SecurityStatus;
  dark: boolean;
  onToggleTheme: () => void;
  onAuthenticated: () => void;
}

export function AuthGate({ status, dark, onToggleTheme, onAuthenticated }: AuthGateProps) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const isSetup = !status.initialized;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (isSetup) {
      if (password.length < 8) {
        setError('管理员密码至少需要 8 位字符');
        return;
      }
      if (password !== confirm) {
        setError('两次输入的密码不一致');
        return;
      }
    }
    setSubmitting(true);
    try {
      if (isSetup) {
        await api.authSetup(password);
      } else {
        await api.authLogin(password);
      }
      onAuthenticated();
    } catch (err) {
      setError(err instanceof Error ? err.message : '认证失败');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#FFFFFF] text-[#0A0A0A] dark:bg-[#0A0A0B] dark:text-[#FAFAFA] flex flex-col">
      <header className="h-14 border-b border-[#E5E7EB] dark:border-[#242429] px-4 sm:px-6 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <TowerMark className="h-8 w-8 shrink-0" />
          <span className="font-bold tracking-[0.14em] text-sm">TOWER</span>
          <span className="text-xs text-[#6B7280] dark:text-[#9CA3AF] border-l border-[#E5E7EB] dark:border-[#242429] pl-2.5">
            塔台控制台
          </span>
        </div>
        <button
          type="button"
          onClick={onToggleTheme}
          className="h-8 w-8 rounded border border-[#E5E7EB] dark:border-[#242429] grid place-items-center text-[#6B7280] hover:text-[#0A0A0A] dark:hover:text-[#FAFAFA] transition-colors"
          title="切换浅色/深色模式"
        >
          {dark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </button>
      </header>

      <main className="flex-1 grid place-items-center px-4 py-10">
        <div className="w-full max-w-sm rounded-lg border border-[#E5E7EB] bg-[#F7F7F8] p-6 dark:border-[#242429] dark:bg-[#141417]">
          <div className="flex items-center gap-2.5 mb-2">
            <div className="w-8 h-8 rounded bg-[#FFFFFF] dark:bg-[#0A0A0B] border border-[#E5E7EB] dark:border-[#242429] grid place-items-center">
              <Lock className="w-4 h-4 text-[#EA580C] dark:text-[#F97316]" />
            </div>
            <div>
              <h1 className="text-base font-semibold tracking-tight">
                {isSetup ? '初始化管理员密码' : '登录塔台控制台'}
              </h1>
              <p className="text-xs text-[#6B7280] dark:text-[#9CA3AF]">
                {isSetup
                  ? '首次启动，请设置用于保护管理后台的访问密码'
                  : '输入管理员密码以管理订阅源、规则与托管链接'}
              </p>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="mt-5 space-y-3.5">
            <div>
              <label className="block text-xs font-medium text-[#6B7280] dark:text-[#9CA3AF] mb-1.5">
                管理员密码
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoFocus
                required
                placeholder={isSetup ? '至少 8 位字符' : '请输入密码'}
                className="w-full h-9 rounded border border-[#E5E7EB] bg-[#FFFFFF] px-3 text-sm outline-none focus:border-[#EA580C] dark:border-[#242429] dark:bg-[#0A0A0B] dark:focus:border-[#F97316]"
              />
            </div>

            {isSetup && (
              <div>
                <label className="block text-xs font-medium text-[#6B7280] dark:text-[#9CA3AF] mb-1.5">
                  确认密码
                </label>
                <input
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                  placeholder="再次输入密码"
                  className="w-full h-9 rounded border border-[#E5E7EB] bg-[#FFFFFF] px-3 text-sm outline-none focus:border-[#EA580C] dark:border-[#242429] dark:bg-[#0A0A0B] dark:focus:border-[#F97316]"
                />
              </div>
            )}

            {error && (
              <div className="rounded border border-[#EA580C]/40 bg-[#EA580C]/10 px-3 py-2 text-xs text-[#EA580C] dark:text-[#F97316]">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full h-9 rounded bg-[#EA580C] text-[#FFFFFF] text-sm font-medium hover:bg-[#C2410C] disabled:opacity-50 transition-colors dark:bg-[#F97316] dark:text-[#0A0A0B] dark:hover:bg-[#EA580C] dark:hover:text-[#FFFFFF]"
            >
              {submitting ? '正在验证...' : isSetup ? '保存密码并进入' : '进入控制台'}
            </button>
          </form>

          <div className="mt-5 pt-4 border-t border-[#E5E7EB] dark:border-[#242429] flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#6B7280] dark:text-[#9CA3AF]">
            <span className="inline-flex items-center gap-1">
              <ShieldCheck className="w-3.5 h-3.5 text-[#EA580C] dark:text-[#F97316]" />
              HttpOnly 会话 + AES-256-GCM 落库
            </span>
            <span className="tabular-mono uppercase">
              {status.databaseDriver === 'postgres' ? 'PostgreSQL' : 'PGlite'}
            </span>
          </div>
        </div>
      </main>
    </div>
  );
}
