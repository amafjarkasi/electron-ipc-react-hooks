import { IpcError } from './errors';
import type { Middleware } from './types';

/**
 * Options for creating a rate limiter middleware.
 */
export interface RateLimiterOptions {
  /** Maximum number of requests allowed within the window */
  max: number;
  /** Time window in milliseconds */
  windowMs: number;
  /** Custom error message (default: 'Rate limit exceeded') */
  message?: string;
  /** Custom error code (default: 'RATE_LIMITED') */
  code?: string;
  /** Custom key generator for grouping requests (default: per-path) */
  keyGenerator?: (opts: { path: string; type: string; ctx: any; input: any }) => string;
}

interface RateLimitEntry {
  timestamps: number[];
}

/**
 * Create a rate limiter middleware that can be used with `.use()`.
 * Tracks request counts per-key within a sliding time window.
 *
 * @example
 * ```ts
 * const rateLimit = createRateLimiter({ max: 10, windowMs: 1000 });
 * const t = initIpc();
 * const appRouter = t.router({
 *   search: t.procedure.use(rateLimit).query(({ input }) => ...),
 * });
 * ```
 */
export function createRateLimiter(options: RateLimiterOptions): Middleware<any, any, any> {
  const {
    max,
    windowMs,
    message = 'Rate limit exceeded',
    code = 'RATE_LIMITED',
    keyGenerator,
  } = options;

  // Store keyed by rate-limit key
  const store = new Map<string, RateLimitEntry>();

  const getDefaultKey = (opts: { path: string; type: string; ctx: any; input: any }) => opts.path;

  return async ({ next, path, type, ctx, input }) => {
    const now = Date.now();
    const key = keyGenerator ? keyGenerator({ path, type, ctx, input }) : getDefaultKey({ path, type, ctx, input });

    let entry = store.get(key);
    if (!entry) {
      entry = { timestamps: [] };
      store.set(key, entry);
    }

    // Prune timestamps outside the window
    entry.timestamps = entry.timestamps.filter(ts => now - ts < windowMs);

    // Check if the limit is exceeded
    if (entry.timestamps.length >= max) {
      throw new IpcError(message, code, { limit: max, windowMs });
    }

    // Record this request
    entry.timestamps.push(now);

    return next();
  };
}