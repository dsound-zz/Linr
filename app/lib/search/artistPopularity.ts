/**
 * artistPopularity.ts
 *
 * Artist popularity index backed by MusicBrainz recording counts and Wikipedia presence.
 * Cached to avoid redundant API calls.
 * Used to identify high-confidence popular artists for artist-scoped recording searches.
 */

import { getMBClient } from "../musicbrainz";
import { getCached, setCached, cacheKeyArtist } from "./cache";

interface ArtistPopularityScore {
  name: string;
  recordingCount: number;
  hasWikipedia: boolean;
  score: number;
}

// In-memory cache for popular artists list (refreshed periodically)
let cachedPopularArtists: string[] | null = null;
let cacheTimestamp: number = 0;
const POPULAR_ARTISTS_CACHE_TTL_MS = 3600000; // 1 hour

/**
 * Get recording count for an artist from MusicBrainz
 */
async function getArtistRecordingCount(artistName: string): Promise<number> {
  const cacheKey = cacheKeyArtist(`recording-count:${artistName}`);
  const cached = await getCached<number>(cacheKey);
  if (cached !== null) return cached;

  try {
    const mb = getMBClient();
    // Search for recordings by this artist to get count
    const result = await mb.search("recording", {
      query: `artist:"${artistName}"`,
      limit: 1, // We only need the count
    });

    const count = result.count ?? 0;
    void setCached(cacheKey, count);
    return count;
  } catch (err) {
    console.error(`Failed to get recording count for ${artistName}:`, err);
    return 0;
  }
}

/**
 * Check if artist has Wikipedia presence
 */
export async function checkWikipediaPresence(
  artistName: string,
): Promise<boolean> {
  const cacheKey = cacheKeyArtist(`wikipedia:${artistName}`);
  const cached = await getCached<boolean>(cacheKey);
  if (cached !== null) return cached;

  try {
    // Simple Wikipedia API check - search for artist name
    const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(
      artistName,
    )}&format=json&srlimit=1`;
    const res = await fetch(searchUrl);
    if (!res.ok) {
      void setCached(cacheKey, false);
      return false;
    }
    type WikipediaSearchResponse = {
      query?: {
        search?: { title?: string }[];
      };
    };
    const json = (await res.json()) as WikipediaSearchResponse;
    const first = json?.query?.search?.[0];
    const hasWikipedia = typeof first?.title === "string";
    void setCached(cacheKey, hasWikipedia);
    return hasWikipedia;
  } catch (err) {
    console.error(`Failed to check Wikipedia for ${artistName}:`, err);
    void setCached(cacheKey, false);
    return false;
  }
}

/**
 * Compute popularity score for an artist
 */
async function computeArtistPopularityScore(
  artistName: string,
): Promise<ArtistPopularityScore> {
  const [recordingCount, hasWikipedia] = await Promise.all([
    getArtistRecordingCount(artistName),
    checkWikipediaPresence(artistName),
  ]);

  // Score based on recording count and Wikipedia presence
  let score = 0;
  if (recordingCount >= 100) score += 50;
  else if (recordingCount >= 50) score += 30;
  else if (recordingCount >= 20) score += 15;
  else if (recordingCount >= 10) score += 5;

  if (hasWikipedia) score += 20;

  return {
    name: artistName,
    recordingCount,
    hasWikipedia,
    score,
  };
}

/**
 * Get popular artists from initial recording search results
 * Extracts artists that appear frequently or have high recording counts
 */
async function derivePopularArtistsFromRecordings(
  artistNames: string[],
  limit: number,
): Promise<string[]> {
  // Score each artist
  const scores = await Promise.all(
    artistNames.map((name) => computeArtistPopularityScore(name)),
  );

  // Sort by score descending
  scores.sort((a, b) => b.score - a.score);

  // Return top artists
  return scores
    .filter((s) => s.score > 0) // Only artists with some popularity signal
    .slice(0, limit)
    .map((s) => s.name);
}

/**
 * Get popular artists for artist-scoped recording searches
 *
 * This function identifies high-confidence popular artists based on:
 * - MusicBrainz recording counts
 * - Wikipedia presence
 *
 * For title-only queries, derives candidates from common modern pop artists
 * that appear frequently in recording search results.
 *
 * @param limit Maximum number of artists to return
 * @param candidateArtists Optional list of candidate artists from recording search
 * @returns Array of popular artist names
 */
export async function getPopularArtists(
  limit: number = 50,
  candidateArtists?: string[],
): Promise<string[]> {
  // If we have candidate artists from recording search, use those
  if (candidateArtists && candidateArtists.length > 0) {
    return derivePopularArtistsFromRecordings(candidateArtists, limit);
  }

  // Otherwise, check cache
  const now = Date.now();
  if (
    cachedPopularArtists &&
    now - cacheTimestamp < POPULAR_ARTISTS_CACHE_TTL_MS
  ) {
    return cachedPopularArtists.slice(0, limit);
  }

  // Build a list of known popular modern pop artists
  // These are artists that frequently appear in modern pop music
  // We'll score them dynamically based on recording counts
  const knownPopularArtists = [
    "Ariana Grande",
    "Taylor Swift",
    "Ed Sheeran",
    "Billie Eilish",
    "The Weeknd",
    "Dua Lipa",
    "Post Malone",
    "Drake",
    "Justin Bieber",
    "Bruno Mars",
    "Adele",
    "Rihanna",
    "Beyoncé",
    "Katy Perry",
    "Lady Gaga",
    "Selena Gomez",
    "Shawn Mendes",
    "Camila Cabello",
    "Harry Styles",
    "Olivia Rodrigo",
    "Doja Cat",
    "Lizzo",
    "SZA",
    "Miley Cyrus",
    "Lana Del Rey",
  ];

  // Score and rank these artists
  const popularArtists = await derivePopularArtistsFromRecordings(
    knownPopularArtists,
    limit,
  );

  // Cache the result
  cachedPopularArtists = popularArtists;
  cacheTimestamp = now;

  return popularArtists;
}
