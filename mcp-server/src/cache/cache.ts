// ─── In-Memory TTL Cache ──────────────────────────────────────────────────────
// Per-entry expiry cache. Used to reduce IIQ API load during RCA investigations.
//
// Cache key strategy (documented per TTL group):
//   identity profiles:   "identity:{userName}"           TTL 5 min
//   exists checks:       "exists:{userName}"             TTL 5 min
//   entitlements:        "entitlements:{identityId}"     TTL 5 min
//   workflow status:     "workflow:{workflowId}"         TTL 60 sec
//   task results:        "tasks:{application}"           TTL 10 min
//   prov transactions:   "prov_tx:{transactionId}"       TTL 5 min
//   freshness:           "freshness:{application}"       TTL 10 min
//   access requests:     NO CACHE (state changes frequently)

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export class Cache {
  private store = new Map<string, CacheEntry<unknown>>();
  private hits = 0;
  private misses = 0;
  private disabled: boolean;

  constructor(disabled = false) {
    this.disabled = disabled;
    if (disabled) {
      console.error('[cache] Disabled (IIQ_USE_MOCK=true) — break_tool overrides will always be effective');
    }
  }

  /**
   * Get a cached value by key.
   * Returns undefined on miss or if the entry has expired (also evicts expired entry).
   * Always returns undefined when the cache is disabled (mock mode).
   */
  get<T>(key: string): T | undefined {
    if (this.disabled) {
      this.misses++;
      return undefined;
    }

    const entry = this.store.get(key) as CacheEntry<T> | undefined;

    if (!entry) {
      this.misses++;
      return undefined;
    }

    if (Date.now() > entry.expiresAt) {
      // Entry expired — evict it
      this.store.delete(key);
      this.misses++;
      return undefined;
    }

    this.hits++;
    return entry.value;
  }

  /**
   * Store a value in the cache with a TTL.
   * @param key   - Cache key
   * @param value - Value to store
   * @param ttlMs - Time-to-live in milliseconds
   * No-op when the cache is disabled (mock mode).
   */
  set<T>(key: string, value: T, ttlMs: number): void {
    if (this.disabled) return;
    this.store.set(key, {
      value,
      expiresAt: Date.now() + ttlMs,
    });
  }

  /**
   * Remove a specific key from the cache.
   */
  invalidate(key: string): void {
    this.store.delete(key);
  }

  /**
   * Remove all keys that start with the given prefix.
   * Useful for invalidating a family of related entries (e.g. all identity caches).
   */
  invalidatePattern(prefix: string): void {
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) {
        this.store.delete(key);
      }
    }
  }

  /**
   * Returns hit/miss/size stats for monitoring.
   */
  stats(): { hits: number; misses: number; size: number; hitRate: string } {
    const total = this.hits + this.misses;
    return {
      hits: this.hits,
      misses: this.misses,
      size: this.store.size,
      hitRate: total > 0 ? `${((this.hits / total) * 100).toFixed(1)}%` : 'N/A',
    };
  }

  /**
   * Evict all expired entries. Call periodically to prevent unbounded memory growth.
   */
  evictExpired(): number {
    const now = Date.now();
    let evicted = 0;
    for (const [key, entry] of this.store.entries()) {
      if (now > entry.expiresAt) {
        this.store.delete(key);
        evicted++;
      }
    }
    return evicted;
  }

  /**
   * Clear all entries from the cache (e.g. for testing).
   */
  clear(): void {
    this.store.clear();
    this.hits = 0;
    this.misses = 0;
  }
}

// ─── Singleton Instance ───────────────────────────────────────────────────────
// Shared cache instance used across all MCP tool handlers.
// Cache is disabled in mock mode so break_tool test overrides are always effective.
const MOCK_MODE = process.env['IIQ_USE_MOCK'] === 'true';
export const cache = new Cache(MOCK_MODE);

// ─── TTL Constants ────────────────────────────────────────────────────────────
// Centralised so changes propagate to all tool files automatically.

/** identity profiles:   "identity:{userName}"           TTL 5 min */
export const IDENTITY_TTL_MS = 5 * 60 * 1000;

/** exists checks:       "exists:{userName}"             TTL 5 min */
export const EXISTS_TTL_MS = 5 * 60 * 1000;

/** entitlements:        "entitlements:{identityId}"     TTL 5 min */
export const ENTITLEMENT_TTL_MS = 5 * 60 * 1000;

/** workflow status:     "workflow:{workflowId}"         TTL 60 sec */
export const WORKFLOW_TTL_MS = 60 * 1000;

/** task results:        "tasks:{application}"           TTL 10 min */
export const TASK_TTL_MS = 10 * 60 * 1000;

/** prov transactions:   "prov_tx:{transactionId}"       TTL 5 min */
export const PROV_TX_TTL_MS = 5 * 60 * 1000;

/** freshness:           "freshness:{application}"       TTL 10 min */
export const FRESHNESS_TTL_MS = 10 * 60 * 1000;

// access requests:     NO CACHE (state changes frequently — never cache)
