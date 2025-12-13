/**
 * canonical.ts
 *
 * Takes a list of normalized recordings and:
 * - Deduplicates by title + artist
 * - Keeps earliest release per recording
 * - Sorts by score
 * - Returns TOP 1 (or top N) canonical result(s)
 */

import type { NormalizedRecording, CanonicalResult } from "./types";

/**
 * Deduplicate recordings by title + artist
 * Keep the one with the highest score
 */
function deduplicateByTitleArtist(
  recordings: NormalizedRecording[],
): NormalizedRecording[] {
  const map = new Map<string, NormalizedRecording>();

  for (const rec of recordings) {
    const key = `${normalize(rec.title)}::${normalize(rec.artist)}`;
    const existing = map.get(key);

    if (!existing || (rec.score ?? 0) > (existing.score ?? 0)) {
      map.set(key, rec);
    }
  }

  return Array.from(map.values());
}

/**
 * Keep only the earliest release per recording
 * (modifies the recording in place by filtering releases)
 */
function keepEarliestRelease(
  recording: NormalizedRecording,
): NormalizedRecording {
  const releases = recording.releases;

  if (releases.length === 0) return recording;

  // Find earliest year
  const years = releases
    .map((r) => (r.year ? parseInt(r.year) : null))
    .filter((y): y is number => y !== null && !isNaN(y));

  if (years.length === 0) {
    // No years, keep first release
    return { ...recording, releases: [releases[0]] };
  }

  const earliestYear = Math.min(...years);
  const earliestReleases = releases.filter(
    (r) => r.year && parseInt(r.year) === earliestYear,
  );

  return {
    ...recording,
    releases: earliestReleases.length > 0 ? earliestReleases : [releases[0]],
  };
}

/**
 * Convert normalized recording to canonical result
 */
function toCanonicalResult(
  recording: NormalizedRecording,
  source: CanonicalResult["source"] = "musicbrainz",
): CanonicalResult {
  // Get earliest release info
  const earliestRelease =
    recording.releases
      .filter((r) => r.year)
      .sort((a, b) => {
        const yearA = parseInt(a.year!);
        const yearB = parseInt(b.year!);
        return yearA - yearB;
      })[0] || recording.releases[0];

  // Determine entity type based on source
  let entityType: CanonicalResult["entityType"] = "recording";
  let explanation: string | undefined;

  if (
    recording.source === "release-track" ||
    recording.source === "album-title-inferred"
  ) {
    entityType = "album_track";
    explanation = "Identified via album context";
  } else if (recording.source === "wikipedia-inferred") {
    if (earliestRelease?.title) {
      entityType = "album_track";
      explanation = "Identified as the title track from album context";
    } else {
      entityType = "song_inferred";
      explanation =
        "Culturally canonical song, not consistently modeled as a recording";
    }
  }

  return {
    id: recording.id,
    title: recording.title,
    artist: recording.artist,
    year: earliestRelease?.year ?? null,
    releaseTitle: earliestRelease?.title ?? null,
    entityType,
    confidenceScore: recording.score ?? 0,
    source,
    explanation,
  };
}

/**
 * Pick the top N canonical results from a list of recordings
 *
 * Process:
 * 1. Deduplicate by title + artist
 * 2. Keep earliest release per recording
 * 3. Sort by score (descending)
 * 4. Return top N
 */
export function canonicalPick(
  recordings: NormalizedRecording[],
  limit = 1,
): CanonicalResult[] {
  if (recordings.length === 0) return [];

  // Step 1: Deduplicate
  let deduped = deduplicateByTitleArtist(recordings);

  // Step 2: Keep earliest release per recording
  deduped = deduped.map(keepEarliestRelease);

  // Step 3: Sort by score (descending)
  deduped.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

  // Step 4: Return top N
  return deduped.slice(0, limit).map((rec) => toCanonicalResult(rec));
}

/**
 * Normalize text for comparison
 */
function normalize(val: string): string {
  return val
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
