/**
 * artistProminence.ts
 *
 * Computes artist prominence scores from metadata.
 * No hardcoded lists - pure data-driven heuristics.
 *
 * Philosophy: Prominence is a seatbelt, not a steering wheel.
 * It guarantees inclusion and slightly influences ranking,
 * but never forces canonical selection alone.
 */

export interface ArtistMetadata {
  artistId: string;
  name: string;
  releaseCount?: number;
  albumCount?: number;
  firstReleaseYear?: number | null;
  lastReleaseYear?: number | null;
  usReleaseCount?: number;
}

export interface ArtistProminence {
  score: number;
  reasons: string[];
}

/**
 * Compute artist prominence score from metadata
 * Pure function - no side effects, no persistence
 */
export function computeArtistProminence(
  meta: ArtistMetadata,
): ArtistProminence {
  let score = 0;
  const reasons: string[] = [];

  // Large discography indicates established artist
  if ((meta.releaseCount ?? 0) >= 10) {
    score += 20;
    reasons.push("large_discography");
  }

  // Multiple studio albums indicates canonical status
  if ((meta.albumCount ?? 0) >= 5) {
    score += 15;
    reasons.push("multiple_studio_albums");
  }

  // Pre-1990 artists are often culturally canonical
  if (meta.firstReleaseYear && meta.firstReleaseYear <= 1990) {
    score += 20;
    reasons.push("pre_1990_artist");
  }

  // US market presence indicates mainstream recognition
  if ((meta.usReleaseCount ?? 0) >= 1) {
    score += 10;
    reasons.push("us_market_presence");
  }

  return { score, reasons };
}

/**
 * Extract artist metadata from a normalized recording
 * This aggregates release data to compute prominence signals
 */
export function extractArtistMetadata(
  recording: {
    artist: string;
    releases: Array<{
      year: string | null;
      country: string | null;
      primaryType: string | null;
    }>;
  },
  artistId?: string,
): ArtistMetadata {
  const releases = recording.releases;
  const releaseCount = releases.length;

  // Count albums (primaryType === "Album")
  const albumCount = releases.filter(
    (r) => r.primaryType?.toLowerCase() === "album",
  ).length;

  // Extract years
  const years = releases
    .map((r) => (r.year ? parseInt(r.year) : null))
    .filter((y): y is number => y !== null && !isNaN(y));

  const firstReleaseYear = years.length > 0 ? Math.min(...years) : null;
  const lastReleaseYear = years.length > 0 ? Math.max(...years) : null;

  // Count US releases
  const usReleaseCount = releases.filter(
    (r) => r.country?.toUpperCase() === "US",
  ).length;

  return {
    artistId: artistId ?? recording.artist.toLowerCase().replace(/\s+/g, "-"),
    name: recording.artist,
    releaseCount,
    albumCount,
    firstReleaseYear,
    lastReleaseYear,
    usReleaseCount,
  };
}

/**
 * Simple in-memory cache for artist prominence scores
 * Keyed by artist name (normalized) with optional TTL
 */
const artistProminenceCache = new Map<
  string,
  { prominence: ArtistProminence; timestamp: number }
>();

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const MAX_CACHE_SIZE = 1000; // Prevent unbounded growth

/**
 * Get cached prominence or compute and cache it
 */
export function getArtistProminence(
  recording: {
    artist: string;
    releases: Array<{
      year: string | null;
      country: string | null;
      primaryType: string | null;
    }>;
  },
  artistId?: string,
): ArtistProminence {
  const cacheKey = recording.artist.toLowerCase().trim();

  // Check cache
  const cached = artistProminenceCache.get(cacheKey);
  const now = Date.now();

  if (cached && now - cached.timestamp < CACHE_TTL_MS) {
    return cached.prominence;
  }

  // Compute prominence
  const metadata = extractArtistMetadata(recording, artistId);
  const prominence = computeArtistProminence(metadata);

  // Evict old entries if cache is full
  if (artistProminenceCache.size >= MAX_CACHE_SIZE) {
    const oldestKey = Array.from(artistProminenceCache.entries()).sort(
      (a, b) => a[1].timestamp - b[1].timestamp,
    )[0]?.[0];
    if (oldestKey) {
      artistProminenceCache.delete(oldestKey);
    }
  }

  // Cache result
  artistProminenceCache.set(cacheKey, {
    prominence,
    timestamp: now,
  });

  return prominence;
}

/**
 * Clear the prominence cache (useful for testing)
 */
export function clearProminenceCache(): void {
  artistProminenceCache.clear();
}
