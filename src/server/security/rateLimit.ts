interface BucketEntry {
  count: number;
  resetAt: number;
  lockedUntil?: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSec: number;
}

export class MemoryRateLimiter {
  private readonly buckets = new Map<string, BucketEntry>();
  private readonly maxAttempts: number;
  private readonly windowMs: number;
  private readonly lockoutMs: number;

  constructor(options: { maxAttempts: number; windowMs: number; lockoutMs?: number }) {
    this.maxAttempts = options.maxAttempts;
    this.windowMs = options.windowMs;
    this.lockoutMs = options.lockoutMs ?? 0;
  }

  check(key: string): RateLimitResult {
    const now = Date.now();
    this.prune(now);
    const entry = this.buckets.get(key);
    if (!entry) {
      return { allowed: true, remaining: this.maxAttempts, retryAfterSec: 0 };
    }
    if (entry.lockedUntil && now < entry.lockedUntil) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterSec: Math.ceil((entry.lockedUntil - now) / 1000),
      };
    }
    if (now >= entry.resetAt) {
      this.buckets.delete(key);
      return { allowed: true, remaining: this.maxAttempts, retryAfterSec: 0 };
    }
    if (entry.count >= this.maxAttempts) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterSec: Math.ceil((entry.resetAt - now) / 1000),
      };
    }
    return {
      allowed: true,
      remaining: Math.max(0, this.maxAttempts - entry.count),
      retryAfterSec: 0,
    };
  }

  consume(key: string): RateLimitResult {
    const now = Date.now();
    this.prune(now);
    const existing = this.buckets.get(key);

    if (existing?.lockedUntil && now < existing.lockedUntil) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterSec: Math.ceil((existing.lockedUntil - now) / 1000),
      };
    }

    if (!existing || now >= existing.resetAt) {
      const next: BucketEntry = { count: 1, resetAt: now + this.windowMs };
      this.buckets.set(key, next);
      return {
        allowed: true,
        remaining: Math.max(0, this.maxAttempts - 1),
        retryAfterSec: 0,
      };
    }

    existing.count += 1;
    if (existing.count > this.maxAttempts) {
      if (this.lockoutMs > 0) {
        existing.lockedUntil = now + this.lockoutMs;
        return {
          allowed: false,
          remaining: 0,
          retryAfterSec: Math.ceil(this.lockoutMs / 1000),
        };
      }
      return {
        allowed: false,
        remaining: 0,
        retryAfterSec: Math.ceil((existing.resetAt - now) / 1000),
      };
    }

    return {
      allowed: true,
      remaining: Math.max(0, this.maxAttempts - existing.count),
      retryAfterSec: 0,
    };
  }

  reset(key: string): void {
    this.buckets.delete(key);
  }

  private prune(now: number): void {
    if (this.buckets.size < 256) return;
    for (const [key, entry] of this.buckets) {
      const expiry = Math.max(entry.resetAt, entry.lockedUntil ?? 0);
      if (now >= expiry) {
        this.buckets.delete(key);
      }
    }
  }
}
