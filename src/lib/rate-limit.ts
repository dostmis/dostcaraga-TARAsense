/**
 * Sliding-window in-memory rate limiter.
 *
 * Suitable for single-instance deployments (local/single-server).
 * For multi-instance or serverless environments, replace the `store` Map
 * with an Upstash Redis client (@upstash/ratelimit) keeping the same
 * `checkRateLimit` interface.
 */

interface WindowEntry {
  count: number;
  windowStart: number;
}

const store = new Map<string, WindowEntry>();

// Periodically sweep expired entries to prevent unbounded memory growth.
if (typeof setInterval !== "undefined") {
  setInterval(
    () => {
      const now = Date.now();
      for (const [key, entry] of store) {
        if (now - entry.windowStart > 24 * 60 * 60 * 1000) {
          store.delete(key);
        }
      }
    },
    5 * 60 * 1000
  );
}

export interface RateLimitConfig {
  /** Maximum requests allowed within windowMs. */
  limit: number;
  /** Window size in milliseconds. */
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

/**
 * Check and increment the rate-limit counter for a given key.
 * Returns whether the request is allowed and how many attempts remain.
 */
export function checkRateLimit(key: string, config: RateLimitConfig): RateLimitResult {
  const now = Date.now();
  const existing = store.get(key);

  if (!existing || now - existing.windowStart >= config.windowMs) {
    store.set(key, { count: 1, windowStart: now });
    return { allowed: true, remaining: config.limit - 1, resetAt: now + config.windowMs };
  }

  existing.count += 1;
  const allowed = existing.count <= config.limit;
  return {
    allowed,
    remaining: Math.max(0, config.limit - existing.count),
    resetAt: existing.windowStart + config.windowMs,
  };
}

// Pre-configured limiters for common endpoints.
export const AUTH_RATE_LIMIT: RateLimitConfig = { limit: 10, windowMs: 15 * 60 * 1000 };
export const CHAT_RATE_LIMIT: RateLimitConfig = { limit: 30, windowMs: 60 * 1000 };
export const REFRESH_RATE_LIMIT: RateLimitConfig = { limit: 30, windowMs: 15 * 60 * 1000 };
export const MUTATION_RATE_LIMIT: RateLimitConfig = { limit: 60, windowMs: 60 * 1000 };
export const SUBMIT_RATE_LIMIT: RateLimitConfig = { limit: 20, windowMs: 60 * 1000 };
