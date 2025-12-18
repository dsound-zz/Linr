/**
 * artistScopedRecording.ts
 *
 * Artist-scoped recording discovery for modern pop hits.
 * Searches recordings by title + artist for high-confidence popular artists.
 * This fills the discovery gap for songs that don't appear in title-only searches.
 */

import { searchByTitleAndArtist } from "./search";
import { normalizeRecordings } from "./normalize";
import { artistsMatch } from "./utils/normalizeArtist";
import type { NormalizedRecording } from "./types";

/**
 * Discover recordings by searching title + artist for popular artists
 *
 * This function performs artist-scoped recording searches for high-confidence
 * popular artists. It's designed to catch modern pop hits that may not appear
 * in title-only searches due to:
 * - High competition in search results
 * - Different normalization/spelling
 * - Recent releases not yet indexed prominently
 *
 * @param params.title - Song title to search for
 * @param params.popularArtists - Array of popular artist names to search
 * @param params.debugInfo - Optional debug info object to populate
 * @returns Array of normalized recordings found via artist-scoped searches
 */
export async function discoverArtistScopedRecordings(params: {
  title: string;
  popularArtists: string[];
  debugInfo?: {
    stages: Record<string, unknown>;
  } | null;
}): Promise<NormalizedRecording[]> {
  const { title, popularArtists, debugInfo } = params;

  // Only run for multi-word title-only queries
  const isMultiWord = title.trim().split(/\s+/).length >= 2;
  if (!isMultiWord || popularArtists.length === 0) {
    return [];
  }

  const foundRecordings: NormalizedRecording[] = [];
  const seenIds = new Set<string>();
  const artistsMatched = new Set<string>();

  // PERFORMANCE: Parallelize artist searches instead of sequential
  // Limit to top 10 artists (reduced from 20) to balance quality and speed
  const topArtists = popularArtists.slice(0, 10);
  const artistsQueried = topArtists;

  // Run all searches in parallel with timeout protection
  const searchResults = await Promise.allSettled(
    topArtists.map(async (artist) => {
      try {
        // Add 5-second timeout per artist search to prevent hanging
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Artist search timeout')), 5000)
        );

        const searchPromise = searchByTitleAndArtist(title, artist, 10);
        const rawRecordings = await Promise.race([searchPromise, timeoutPromise]);
        const normalized = normalizeRecordings(rawRecordings);
        return { artist, recordings: normalized };
      } catch (err) {
        console.error(
          `Failed to search recordings for "${title}" by "${artist}":`,
          err,
        );
        return { artist, recordings: [] };
      }
    }),
  );

  // Process results
  for (const result of searchResults) {
    if (result.status === "fulfilled" && result.value.recordings.length > 0) {
      const { artist, recordings } = result.value;

      for (const rec of recordings) {
        if (!seenIds.has(rec.id)) {
          seenIds.add(rec.id);
          // Mark as artist-scoped recording for must-include tracking
          (
            rec as NormalizedRecording & { fromArtistScopedSearch?: boolean }
          ).fromArtistScopedSearch = true;
          foundRecordings.push(rec);

          // Track which artists matched (using normalized artist comparison)
          if (artistsMatch(rec.artist, artist)) {
            artistsMatched.add(artist);
          }
        }
      }
    }
  }

  // Add debug logging
  if (debugInfo) {
    debugInfo.stages.artistScopedRecordingSearch = {
      artistsQueried: artistsQueried.length,
      recordingsFound: foundRecordings.length,
      artistsMatched: Array.from(artistsMatched),
    };
  }

  return foundRecordings;
}
