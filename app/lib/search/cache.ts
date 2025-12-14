/**
 * cache.ts
 *
 * Cache layer for MusicBrainz/Wikipedia calls.
 *
 * - Always uses an in-memory TTL cache (fast, per-process).
 * - Optionally uses Redis (Upstash REST) when env vars are present, to persist
 *   cache entries across restarts and serverless instances.
 */

import { Redis } from "@upstash/redis";

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

const CACHE_TTL_MS = 300000; // 5 minutes
const CACHE_TTL_SECONDS = Math.ceil(CACHE_TTL_MS / 1000);
const cache = new Map<string, CacheEntry<unknown>>();

let redisClient: Redis | null = null;

function getRedisClient(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;

  if (!redisClient) {
    redisClient = new Redis({ url, token });
  }
  return redisClient;
}

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
  if (entry) {
    const age = Date.now() - entry.timestamp;
    if (age <= CACHE_TTL_MS) {
      return entry.data as T;
    }
    cache.delete(key);
    // fall through to Redis (if enabled)
  }

  // Optional Redis lookup (also used on pure in-memory miss)
  const redis = getRedisClient();
  if (!redis) return null;

  try {
    const raw = await redis.get<string>(key);
    if (typeof raw !== "string") return null;
    const parsed = JSON.parse(raw) as T;
    cache.set(key, { data: parsed as unknown, timestamp: Date.now() });
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Store result in cache
 */
export async function setCached<T>(key: string, data: T): Promise<void> {
  cache.set(key, {
    data: data as unknown,
    timestamp: Date.now(),
  });

  const redis = getRedisClient();
  if (!redis) return;

  try {
    // Store JSON string with TTL.
    await redis.set(key, JSON.stringify(data), { ex: CACHE_TTL_SECONDS });
  } catch {
    // Best-effort only; never fail the request path due to cache errors.
  }
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
