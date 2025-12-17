/**
 * cache.ts
 *
 * In-memory TTL cache for MusicBrainz/Wikipedia calls.
 */

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

// PERFORMANCE: 1 hour TTL for better hit rates
// Music metadata rarely changes, so longer TTL is safe
const CACHE_TTL_MS = 3600000; // 1 hour (60 * 60 * 1000)
const cache = new Map<string, CacheEntry<unknown>>();

/**
 * Clear all cached entries.
 *
 * NOTE: This is primarily used by tests to avoid cross-test contamination,
 * since the cache is module-scoped and would otherwise persist between tests.
 */
export function clearCache(): void {
  cache.clear();
}

/**
 * Generate cache key from query parameters
 */
function cacheKey(
  queryType: "recording" | "release" | "artist",
  query: string,
  artist?: string | null,
): string {
  const parts = [queryType, query];
  if (artist) parts.push(artist);
  return parts.join("::");
}

/**
 * Get cached result if available and not expired
 */
export async function getCached<T>(key: string): Promise<T | null> {
  const entry = cache.get(key);
  if (!entry) return null;

  const age = Date.now() - entry.timestamp;
  if (age <= CACHE_TTL_MS) {
    return entry.data as T;
  }

  // Expired - remove from cache
  cache.delete(key);
  return null;
}

/**
 * Store result in cache
 */
export async function setCached<T>(key: string, data: T): Promise<void> {
  cache.set(key, {
    data: data as unknown,
    timestamp: Date.now(),
  });
}

/**
 * Cache wrapper for recording searches
 */
export function cacheKeyRecording(
  query: string,
  artist?: string | null,
): string {
  return cacheKey("recording", query, artist);
}

/**
 * Cache wrapper for release searches
 */
export function cacheKeyRelease(query: string): string {
  return cacheKey("release", query);
}

/**
 * Cache wrapper for artist searches
 */
export function cacheKeyArtist(query: string): string {
  return cacheKey("artist", query);
}
