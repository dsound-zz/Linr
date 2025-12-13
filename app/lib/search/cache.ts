/**
 * cache.ts
 *
 * Simple in-memory cache with TTL for MusicBrainz search results.
 * Reduces latency by avoiding redundant API calls.
 */

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

const CACHE_TTL_MS = 300000; // 5 minutes
const cache = new Map<string, CacheEntry<any>>();

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
export function getCached<T>(key: string): T | null {
  const entry = cache.get(key);
  if (!entry) return null;

  const age = Date.now() - entry.timestamp;
  if (age > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }

  return entry.data as T;
}

/**
 * Store result in cache
 */
export function setCached<T>(key: string, data: T): void {
  cache.set(key, {
    data,
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
