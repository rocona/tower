import crypto from 'node:crypto';
import type { AppConfig } from '../config.js';
import type { TowerRepository } from '../db/repository.js';
import {
  generateSecureToken,
  hashPassword,
  signSessionToken,
  verifyPassword,
  verifySessionToken,
} from '../security/crypto.js';

const ADMIN_HASH_KEY = 'admin_password_hash';
const SESSION_SECRET_KEY = 'session_secret';
const SESSION_VERSION_KEY = 'session_version';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function timingSafeStringEqual(a: string, b: string): boolean {
  const hashA = crypto.createHash('sha256').update(a, 'utf8').digest();
  const hashB = crypto.createHash('sha256').update(b, 'utf8').digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

export class AuthService {
  private readonly config: AppConfig;
  private readonly repo: TowerRepository;
  private cachedSecret: string | null = null;

  constructor(config: AppConfig, repo: TowerRepository) {
    this.config = config;
    this.repo = repo;
  }

  get isExternalPassword(): boolean {
    return Boolean(this.config.adminPassword);
  }

  async isInitialized(): Promise<boolean> {
    if (this.config.adminPassword) return true;
    const stored = await this.repo.getSetting(ADMIN_HASH_KEY);
    return Boolean(stored);
  }

  private async getSessionSecret(): Promise<string> {
    if (this.config.sessionSecret) return this.config.sessionSecret;
    if (this.cachedSecret) return this.cachedSecret;
    const secret = await this.repo.getOrCreateSetting(SESSION_SECRET_KEY, () =>
      generateSecureToken(48),
    );
    this.cachedSecret = secret;
    return secret;
  }

  private async getSessionVersion(): Promise<number> {
    const raw = await this.repo.getSetting(SESSION_VERSION_KEY);
    const parsed = Number(raw);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
  }

  async setupInitialPassword(password: string): Promise<void> {
    if (this.config.adminPassword) {
      throw new Error('管理员密码已通过环境变量 ADMIN_PASSWORD 配置');
    }
    if (await this.isInitialized()) {
      throw new Error('管理员密码已初始化');
    }
    if (password.length < 8) {
      throw new Error('管理员密码长度至少需要 8 位');
    }
    const hash = await hashPassword(password);
    await this.repo.setSetting(ADMIN_HASH_KEY, hash);
    await this.repo.setSetting(SESSION_VERSION_KEY, '1');
  }

  async verifyAdminPassword(password: string): Promise<boolean> {
    if (!password) return false;
    if (this.config.adminPassword) {
      return timingSafeStringEqual(password, this.config.adminPassword);
    }
    const stored = await this.repo.getSetting(ADMIN_HASH_KEY);
    if (!stored) return false;
    return verifyPassword(password, stored);
  }

  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    if (this.config.adminPassword) {
      throw new Error('当前使用环境变量 ADMIN_PASSWORD，请在部署配置中修改');
    }
    const ok = await this.verifyAdminPassword(currentPassword);
    if (!ok) {
      throw new Error('当前密码不正确');
    }
    if (newPassword.length < 8) {
      throw new Error('新密码长度至少需要 8 位');
    }
    const nextVer = (await this.getSessionVersion()) + 1;
    await this.repo.setSetting(ADMIN_HASH_KEY, await hashPassword(newPassword));
    await this.repo.setSetting(SESSION_VERSION_KEY, String(nextVer));
  }

  async issueSessionToken(): Promise<{ token: string; maxAgeSec: number }> {
    const secret = await this.getSessionSecret();
    const ver = await this.getSessionVersion();
    const now = Date.now();
    const token = signSessionToken(
      { ver, iat: now, exp: now + SESSION_TTL_MS },
      secret,
    );
    return { token, maxAgeSec: Math.floor(SESSION_TTL_MS / 1000) };
  }

  async verifySession(token: string | undefined): Promise<boolean> {
    if (!token) return false;
    const secret = await this.getSessionSecret();
    const ver = await this.getSessionVersion();
    return verifySessionToken(token, secret, ver) !== null;
  }
}
