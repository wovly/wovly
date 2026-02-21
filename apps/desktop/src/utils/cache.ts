/**
 * Caching Utilities
 * Provides in-memory caching for responses and entity resolutions
 */

interface CacheEntry<T> {
  value: T;
  timestamp: number;
  ttl: number;
}

export interface CacheStats {
  size: number;
  maxSize: number;
  expired: number;
  active: number;
}

/**
 * Simple LRU cache with TTL support
 */
export class Cache<T = unknown> {
  protected readonly cache: Map<string, CacheEntry<T>>;
  private readonly maxSize: number;
  private readonly defaultTTL: number;

  constructor(maxSize: number = 1000, defaultTTL: number = 3600000) {
    this.cache = new Map();
    this.maxSize = maxSize;
    this.defaultTTL = defaultTTL; // Default 1 hour
  }

  /**
   * Set a value in the cache
   * @param key - Cache key
   * @param value - Value to cache
   * @param ttl - Time to live in milliseconds
   */
  set(key: string, value: T, ttl: number = this.defaultTTL): void {
    // Evict oldest entry if at capacity
    if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }

    this.cache.set(key, {
      value,
      timestamp: Date.now(),
      ttl,
    });
  }

  /**
   * Get a value from the cache
   * @param key - Cache key
   * @returns Cached value or null if not found/expired
   */
  get(key: string): T | null {
    const entry = this.cache.get(key);

    if (!entry) {
      return null;
    }

    const age = Date.now() - entry.timestamp;

    // Check if expired
    if (age > entry.ttl) {
      this.cache.delete(key);
      return null;
    }

    // Move to end (LRU)
    this.cache.delete(key);
    this.cache.set(key, entry);

    return entry.value;
  }

  /**
   * Check if a key exists and is not expired
   * @param key - Cache key
   * @returns True if key exists and is not expired
   */
  has(key: string): boolean {
    return this.get(key) !== null;
  }

  /**
   * Delete a key from the cache
   * @param key - Cache key
   */
  delete(key: string): void {
    this.cache.delete(key);
  }

  /**
   * Clear all entries
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Get cache statistics
   * @returns Cache stats
   */
  getStats(): CacheStats {
    let expired = 0;
    const now = Date.now();

    for (const [, entry] of this.cache.entries()) {
      if (now - entry.timestamp > entry.ttl) {
        expired++;
      }
    }

    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      expired,
      active: this.cache.size - expired,
    };
  }

  /**
   * Clean up expired entries
   * @returns Number of entries cleaned up
   */
  cleanup(): number {
    const now = Date.now();
    const keysToDelete: string[] = [];

    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > entry.ttl) {
        keysToDelete.push(key);
      }
    }

    for (const key of keysToDelete) {
      this.cache.delete(key);
    }

    return keysToDelete.length;
  }
}

export interface CachedResponse {
  fromCache: true;
  [key: string]: unknown;
}

/**
 * Response cache for query results
 */
export class ResponseCache extends Cache<Record<string, unknown>> {
  constructor() {
    super(500, 3600000); // 500 entries, 1 hour default TTL
  }

  /**
   * Generate cache key from query and user ID
   * @param query - User query
   * @param userId - User ID
   * @returns Cache key
   */
  getCacheKey(query: string, userId: string): string {
    const normalized = query.toLowerCase().trim();
    return `${userId}:${normalized}`;
  }

  /**
   * Get cached response for a query
   * @param query - User query
   * @param userId - User ID
   * @returns Cached response or null
   */
  getCachedResponse(query: string, userId: string): CachedResponse | null {
    const key = this.getCacheKey(query, userId);
    const cached = this.get(key);

    if (cached) {
      // Cache hit
      return {
        ...cached,
        fromCache: true,
      };
    }

    // Cache miss
    return null;
  }

  /**
   * Cache a response
   * @param query - User query
   * @param userId - User ID
   * @param response - Response to cache
   * @param ttl - Time to live (default: 1 hour for simple queries)
   */
  cacheResponse(
    query: string,
    userId: string,
    response: Record<string, unknown>,
    ttl?: number
  ): void {
    const key = this.getCacheKey(query, userId);

    // Determine TTL based on query type
    if (!ttl) {
      // Data queries get shorter TTL (5 minutes)
      const isDataQuery =
        /\b(today|schedule|calendar|email|messages?|weather|latest)\b/i.test(query);
      ttl = isDataQuery ? 300000 : 3600000; // 5 min vs 1 hour
    }

    this.set(key, response, ttl);
    // Response cached with TTL
  }

  /**
   * Invalidate cache entries matching a pattern
   * @param pattern - Pattern to match
   * @returns Number of entries invalidated
   */
  invalidatePattern(pattern: string | RegExp): number {
    const keysToDelete: string[] = [];
    const regex = typeof pattern === 'string' ? new RegExp(pattern, 'i') : pattern;

    for (const key of this.cache.keys()) {
      if (regex.test(key)) {
        keysToDelete.push(key);
      }
    }

    for (const key of keysToDelete) {
      this.cache.delete(key);
    }

    // Entries invalidated matching pattern
    return keysToDelete.length;
  }
}

/**
 * Entity resolution cache
 */
export class EntityCache extends Cache<unknown> {
  constructor() {
    super(1000, 86400000); // 1000 entries, 24 hour TTL
  }

  /**
   * Generate cache key for entity
   * @param userId - User ID
   * @param entityType - Type of entity (person, date, location, etc.)
   * @param entityValue - Entity value
   * @returns Cache key
   */
  getEntityKey(userId: string, entityType: string, entityValue: string): string {
    const normalized = entityValue.toLowerCase().trim();
    return `${userId}:${entityType}:${normalized}`;
  }

  /**
   * Get cached entity resolution
   * @param userId - User ID
   * @param entityType - Type of entity
   * @param entityValue - Entity value
   * @returns Resolved entity or null
   */
  getEntity(userId: string, entityType: string, entityValue: string): unknown | null {
    const key = this.getEntityKey(userId, entityType, entityValue);
    return this.get(key);
  }

  /**
   * Cache an entity resolution
   * @param userId - User ID
   * @param entityType - Type of entity
   * @param entityValue - Entity value
   * @param resolution - Resolved value
   */
  cacheEntity(
    userId: string,
    entityType: string,
    entityValue: string,
    resolution: unknown
  ): void {
    const key = this.getEntityKey(userId, entityType, entityValue);
    this.set(key, resolution);
    // Entity cached
  }

  /**
   * Invalidate all entities for a user
   * @param userId - User ID
   * @returns Number of entries invalidated
   */
  invalidateUser(userId: string): number {
    const keysToDelete: string[] = [];

    for (const key of this.cache.keys()) {
      if (key.startsWith(`${userId}:`)) {
        keysToDelete.push(key);
      }
    }

    for (const key of keysToDelete) {
      this.cache.delete(key);
    }

    // Entities invalidated for user
    return keysToDelete.length;
  }
}

// Singleton instances
export const responseCache = new ResponseCache();
export const entityCache = new EntityCache();

// Cleanup interval (every 5 minutes)
setInterval(() => {
  responseCache.cleanup();
  entityCache.cleanup();
  // Cache cleanup completed
}, 300000);
