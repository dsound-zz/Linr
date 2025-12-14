/**
 * creditsPipeline.ts
 *
 * Main orchestrator for credits resolution pipeline.
 * Coordinates MusicBrainz and Wikipedia fetching, normalization, and merging.
 */

import {
  fetchMusicBrainzCredits,
  detectMissingRoles,
} from "./musicbrainzCredits";
import { fetchWikipediaCredits } from "./wikipediaCredits";
import { normalizeCredits } from "./normalizeCredits";
import { mergeCredits, sortCredits } from "./mergeCredits";
import type { CreditsEntity, RecordingCredits } from "./types";

const SPARSE_MISSING_ROLES = [
  "producer",
  "writer",
  "composer",
  "mixer",
  "recording_engineer",
  "performer", // Include to catch instrument roles from Wikipedia
] as const;

/**
 * Resolve credits for a music entity
 *
 * Pipeline flow:
 * 1. Fetch MusicBrainz credits
 * 2. Normalize MB credits
 * 3. Detect missing roles
 * 4. Fetch Wikipedia credits only for missing roles
 * 5. Normalize Wikipedia credits
 * 6. Merge and deduplicate
 * 7. Sort by role priority
 * 8. Return structured credits
 */
export async function resolveCredits(
  entity: CreditsEntity,
): Promise<RecordingCredits> {
  // Step 1: Fetch MusicBrainz credits
  const mbResult = await fetchMusicBrainzCredits(entity);
  const mbCredits = mbResult.credits;
  const mbLocation = mbResult.recordingLocation;

  // Step 2: Normalize MB credits
  const normalizedMBCredits = normalizeCredits(mbCredits);

  // Step 3: Detect missing roles
  // If MB credits are sparse (< 3 credits), fetch Wikipedia to fill gaps
  // Include "performer" in missing roles for sparse data to catch instrument roles
  const missingRoles =
    normalizedMBCredits.length < 3
      ? [...SPARSE_MISSING_ROLES]
      : detectMissingRoles(normalizedMBCredits) || [];

  // Step 4: Fetch Wikipedia credits only if needed
  let wikiCredits: typeof normalizedMBCredits = [];
  let wikiLocation: typeof mbLocation = undefined;

  if (missingRoles.length > 0) {
    const wikiResult = await fetchWikipediaCredits(entity, missingRoles);
    wikiCredits = normalizeCredits(wikiResult.credits);
    wikiLocation = wikiResult.recordingLocation;
  }

  // Step 5: Merge credits (deduplication happens here)
  const mergedCredits = mergeCredits(normalizedMBCredits, wikiCredits);

  // Step 6: Sort by role priority
  const sortedCredits = sortCredits(mergedCredits);

  // Step 7: Merge locations (prefer MB, fallback to Wikipedia)
  const recordingLocation = mbLocation || wikiLocation;

  // Step 8: Return structured credits
  return {
    title: entity.title,
    artist: entity.artist,
    year: entity.year || null,
    credits: sortedCredits,
    recordingLocation,
  };
}
