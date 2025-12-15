/**
 * search.ts
 *
 * Responsible ONLY for querying MusicBrainz.
 * For single-word queries, applies canonical-song search behavior.
 */

import { getMBClient } from "../musicbrainz";
import type { MusicBrainzRecording, MusicBrainzArtist } from "../types";
import {
  getCached,
  setCached,
  cacheKeyRecording,
  cacheKeyRelease,
} from "./cache";

/**
 * Search recordings by title only
 * For single-word queries, enforces canonical-song behavior
 * Uses caching to reduce latency
 */
export async function searchByTitle(
  title: string,
  limit = 200,
): Promise<MusicBrainzRecording[]> {
  const cacheKey = cacheKeyRecording(`title:${title}:${limit}`);
  const cached = await getCached<MusicBrainzRecording[]>(cacheKey);
  if (cached) return cached;

  const mb = getMBClient();
  const isSingleWord = title.trim().split(/\s+/).length === 1;

  if (!isSingleWord) {
    // Multi-word queries: use existing fuzzy search behavior
    const recordings: MusicBrainzRecording[] = [];
    const pageSize = 25; // MB search max

    for (
      let offset = 0;
      offset < limit && recordings.length < limit;
      offset += pageSize
    ) {
      const result = await mb.search("recording", {
        query: title,
        limit: pageSize,
        offset,
      });

      const rawRecordings = result.recordings ?? [];
      recordings.push(...rawRecordings);

      if (rawRecordings.length < pageSize) break;
    }

    void setCached(cacheKey, recordings);
    return recordings;
  }

  // SINGLE-WORD QUERY: Use quoted query at API level
  // Preserve original case (don't lowercase) - MusicBrainz is case-sensitive for quoted queries
  // Convert to TitleCase for better matching (e.g., "jump" -> "Jump")
  const titleCase =
    title.charAt(0).toUpperCase() + title.slice(1).toLowerCase();
  const mbQuery = `recording:"${titleCase}"`;

  // Log the query being sent to MusicBrainz
  console.log("[MB SEARCH] Single-word query:", {
    original: title,
    titleCase,
    mbQuery,
    urlEncoded: encodeURIComponent(mbQuery),
  });

  const recordings: MusicBrainzRecording[] = [];
  const pageSize = 25; // MB search max

  // Always use quoted query for single-word searches
  // This is the key fix: query intent enforced at API level, not post-processing
  for (
    let offset = 0;
    offset < limit && recordings.length < limit;
    offset += pageSize
  ) {
    try {
      // Log the actual request parameters
      const searchParams = {
        query: mbQuery,
        limit: pageSize,
        offset,
      };
      console.log(
        "[MB SEARCH] Request params:",
        JSON.stringify(searchParams, null, 2),
      );

      const result = await mb.search("recording", searchParams);

      const rawRecordings = result.recordings ?? [];
      console.log(
        `[MB SEARCH] Response: ${rawRecordings.length} recordings at offset ${offset}`,
      );

      if (rawRecordings.length > 0) {
        console.log(
          "[MB SEARCH] Sample recordings:",
          rawRecordings.slice(0, 3).map((r) => ({
            id: r.id,
            title: r.title,
            artist:
              r["artist-credit"]?.[0]?.name ||
              r["artist-credit"]?.[0]?.artist?.name ||
              "unknown",
          })),
        );
      }

      recordings.push(...rawRecordings);

      if (rawRecordings.length < pageSize) break;
    } catch (err) {
      // If search fails, log and break (don't fallback to unquoted)
      console.error(
        "[MB SEARCH] Quoted title search failed:",
        err instanceof Error ? err.message : String(err),
        err,
      );
      break;
    }
  }

  // DO NOT filter before returning - return raw MusicBrainz recordings
  // Let the pipeline handle filtering and scoring
  console.log(`[MB SEARCH] Total recordings returned: ${recordings.length}`);
  const result = recordings.slice(0, limit);
  void setCached(cacheKey, result);
  return result;
}

/**
 * Search recordings by exact title using quoted syntax
 * Example: recording:"Jump"
 */
export async function searchByExactTitle(
  title: string,
  limit = 100,
): Promise<MusicBrainzRecording[]> {
  const mb = getMBClient();
  // Convert to TitleCase for better matching (e.g., "jump" -> "Jump")
  const titleCase =
    title.charAt(0).toUpperCase() + title.slice(1).toLowerCase();
  const query = `recording:"${titleCase}"`;

  const recordings: MusicBrainzRecording[] = [];
  const pageSize = 25; // MB search max

  for (
    let offset = 0;
    offset < limit && recordings.length < limit;
    offset += pageSize
  ) {
    try {
      const result = await mb.search("recording", {
        query,
        limit: pageSize,
        offset,
      });

      const rawRecordings = result.recordings ?? [];
      recordings.push(...rawRecordings);

      if (rawRecordings.length < pageSize) break;
    } catch (err) {
      console.error("Exact title search failed:", err);
      break;
    }
  }

  return recordings.slice(0, limit);
}

/**
 * Search for exact recording title match using quoted syntax
 * MusicBrainz query: recording:"Jump"
 * Returns raw MusicBrainz recordings for exact title matches only
 * Uses caching to reduce latency
 */
export async function searchExactRecordingTitle(
  title: string,
): Promise<MusicBrainzRecording[]> {
  const cacheKey = cacheKeyRecording(`exact:${title}`);
  const cached = await getCached<MusicBrainzRecording[]>(cacheKey);
  if (cached) return cached;

  const mb = getMBClient();
  // Convert to TitleCase for better matching (e.g., "jump" -> "Jump")
  const titleCase =
    title.charAt(0).toUpperCase() + title.slice(1).toLowerCase();
  const query = `recording:"${titleCase}"`;

  const recordings: MusicBrainzRecording[] = [];
  const pageSize = 25; // MB search max
  const limit = 100;

  for (
    let offset = 0;
    offset < limit && recordings.length < limit;
    offset += pageSize
  ) {
    try {
      const result = await mb.search("recording", {
        query,
        limit: pageSize,
        offset,
      });

      const rawRecordings = result.recordings ?? [];
      recordings.push(...rawRecordings);

      if (rawRecordings.length < pageSize) break;
    } catch (err) {
      console.error("Exact recording title search failed:", err);
      break;
    }
  }

  const result = recordings;
  void setCached(cacheKey, result);
  return result;
}

/**
 * Search recordings by title AND artist name
 * Uses caching to reduce latency
 */
export async function searchByTitleAndArtist(
  title: string,
  artist: string,
  limit = 50,
): Promise<MusicBrainzRecording[]> {
  const cacheKey = cacheKeyRecording(`title:${title}`, artist);
  const cached = await getCached<MusicBrainzRecording[]>(cacheKey);
  if (cached) return cached;

  const mb = getMBClient();
  const qTitle = (title ?? "").replace(/’/g, "'");
  const qArtist = (artist ?? "").replace(/’/g, "'");

  const toTitleCase = (s: string) =>
    s.length ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : s;

  const isSingleWord = qTitle.trim().split(/\s+/).length === 1;
  const titleCase = toTitleCase(qTitle.trim());

  const run = async (t: string) => {
    const query = `recording:"${t}" AND artist:"${qArtist}"`;
    const result = await mb.search("recording", { query, limit });
    return result.recordings ?? [];
  };

  // MusicBrainz quoted queries can be case-sensitive; if the user typed a
  // lowercase title, retry with TitleCase when needed.
  let recordings = await run(qTitle);
  if (recordings.length === 0 && (isSingleWord || !/[A-Z]/.test(qTitle))) {
    if (titleCase && titleCase !== qTitle) {
      recordings = await run(titleCase);
    }
  }

  void setCached(cacheKey, recordings);
  return recordings;
}

/**
 * Search releases by exact title and extract matching tracks
 * Used as fallback when recording search fails for single-word queries
 * Uses caching to reduce latency
 */
export async function searchReleaseByTitle(
  title: string,
): Promise<MusicBrainzRecording[]> {
  const cacheKey = cacheKeyRelease(`exact:${title}`);
  const cached = await getCached<MusicBrainzRecording[]>(cacheKey);
  if (cached) return cached;

  const mb = getMBClient();
  // Convert to TitleCase for better matching
  const titleCase =
    title.charAt(0).toUpperCase() + title.slice(1).toLowerCase();
  const query = `release:"${titleCase}"`;

  try {
    // Search for releases with this title
    const result = await mb.search("release", {
      query,
      limit: 50,
    });

    const releases = result.releases ?? [];
    if (releases.length === 0) return [];

    // Filter to Album releases only
    const albumReleases = releases.filter((r) => {
      const primaryType =
        r["release-group"]?.["primary-type"]?.toLowerCase() ?? "";
      return primaryType === "album";
    });

    if (albumReleases.length === 0) return [];

    // Sort by date (earliest first)
    albumReleases.sort((a, b) => {
      const aAny = a as unknown as Record<string, string | undefined>;
      const bAny = b as unknown as Record<string, string | undefined>;
      const dateA = a.date ?? aAny["first-release-date"] ?? "";
      const dateB = b.date ?? bAny["first-release-date"] ?? "";
      return dateA.localeCompare(dateB);
    });

    // Lookup releases to get tracklists (limit to first 10 to avoid too many API calls)
    const recordings: MusicBrainzRecording[] = [];
    const normalizedQuery = title.toLowerCase().trim();

    for (const release of albumReleases.slice(0, 10)) {
      if (!release.id) continue;

      try {
        // Lookup release with recordings included
        const releaseDetail = await mb.lookup("release", release.id, [
          "recordings",
        ]);

        // Extract tracks from release
        const media = releaseDetail.media ?? [];
        for (const medium of media) {
          const tracks = medium.tracks ?? [];
          for (const track of tracks) {
            const recording = track.recording;
            if (!recording) continue;

            // Check if track title matches query (strict)
            const trackTitle = recording.title ?? "";
            if (trackTitle.toLowerCase().trim() === normalizedQuery) {
              // Build a MusicBrainzRecording-like object from track + release
              const recordingWithRelease: MusicBrainzRecording = {
                id: recording.id,
                title: recording.title,
                "artist-credit":
                  recording["artist-credit"] ?? release["artist-credit"],
                length: recording.length,
                releases: [
                  {
                    id: release.id,
                    title: release.title ?? releaseDetail.title,
                    date: release.date ?? releaseDetail.date,
                    country: release.country ?? releaseDetail.country,
                    "release-group":
                      release["release-group"] ??
                      releaseDetail["release-group"],
                  },
                ],
              };
              recordings.push(recordingWithRelease);
            }
          }
        }
      } catch (err) {
        console.error(`Failed to lookup release ${release.id}:`, err);
        continue;
      }
    }

    void setCached(cacheKey, recordings);
    return recordings;
  } catch (err) {
    console.error("Release search failed:", err);
    return [];
  }
}

/**
 * Search recordings by title AND artist name
 * Used for candidate expansion with prominent artists
 * Uses caching to reduce latency
 */
export async function searchByTitleAndArtistName(
  title: string,
  artist: string,
  limit = 25,
): Promise<MusicBrainzRecording[]> {
  const cacheKey = cacheKeyRecording(`exact:${title}`, artist);
  const cached = await getCached<MusicBrainzRecording[]>(cacheKey);
  if (cached) return cached;

  const mb = getMBClient();
  const titleCase =
    title.charAt(0).toUpperCase() + title.slice(1).toLowerCase();
  const query = `recording:"${titleCase}" AND artist:"${artist}"`;

  try {
    const result = await mb.search("recording", { query, limit });
    const recordings = result.recordings ?? [];
    void setCached(cacheKey, recordings);
    return recordings;
  } catch (err) {
    console.error(`Search failed for "${title}" by "${artist}":`, err);
    return [];
  }
}

/**
 * Search for an artist by name
 * Returns the top match (highest score)
 */
export async function searchArtist(
  name: string,
): Promise<MusicBrainzArtist | null> {
  const mb = getMBClient();
  const result = await mb.search("artist", { query: name, limit: 5 });

  const artists = result.artists || [];
  if (artists.length === 0) return null;

  // Return highest scoring artist
  return artists[0];
}
