/**
 * rank.ts
 *
 * ONE scoring function that assigns a numeric score to recordings.
 * Higher score = more likely to be the canonical version.
 */

import type { NormalizedRecording } from "./types";
import { isStudioRecording, isUSOrWorldwideRelease } from "./filters";

/**
 * Score a recording based on how well it matches the query
 *
 * Scoring factors:
 * - Exact title match: +40
 * - Prefix title match: +30
 * - Contains title: +20
 * - Artist match (if supplied): +25
 * - Studio recording: +10
 * - US/worldwide release: +5
 * - Album release: +10
 * - Single release: +5
 * - Earliest release year: older songs get slight boost
 * - MusicBrainz score: light weight (raw score / 10)
 */
export function scoreRecording(
  recording: NormalizedRecording,
  query: { title: string; artist?: string | null },
): number {
  let score = 0;

  const recTitle = normalize(recording.title);
  const qTitle = normalize(query.title);

  // Title matching (highest priority)
  if (recTitle && qTitle) {
    const isSingleWordQuery = qTitle.split(" ").length === 1;

    if (recTitle === qTitle) {
      // Exact title match should dominate for single-word queries
      score += isSingleWordQuery ? 100 : 40;
    } else if (isSingleWordQuery) {
      // Penalize longer titles for single-word queries
      score -= 30;
    } else if (recTitle.startsWith(qTitle)) {
      score += 30;
    } else if (recTitle.includes(qTitle)) {
      score += 20;
    }
  }

  // Penalize repeated-word titles for single-word queries
  if (query.title && query.title.trim().split(/\s+/).length === 1) {
    const normalizedTitle = normalize(recording.title);
    const words = normalizedTitle.split(" ");

    const uniqueWords = new Set(words);
    if (uniqueWords.size === 1 && words.length > 1) {
      // e.g. "jump jump jump"
      score -= 25;
    }
  }

  // Artist matching (if provided)
  if (query.artist) {
    const recArtist = normalize(recording.artist);
    const qArtist = normalize(query.artist);

    if (recArtist === qArtist || recArtist.includes(qArtist)) {
      score += 25;
    } else {
      score -= 10; // Penalty for wrong artist
    }
  }

  // Studio recording bonus
  if (isStudioRecording(recording)) {
    score += 10;
  } else {
    score -= 20; // Penalty for non-studio
  }

  // US/worldwide release bonus
  if (isUSOrWorldwideRelease(recording)) {
    score += 5;
  }

  // Release type bonuses
  const releases = recording.releases;
  const hasAlbum = releases.some(
    (r) => r.primaryType?.toLowerCase() === "album",
  );
  const hasSingle = releases.some(
    (r) => r.primaryType?.toLowerCase() === "single",
  );

  if (hasAlbum) score += 10;
  if (hasSingle) score += 5;

  // Earliest release year (older songs get slight boost for cultural recognition)
  const years = releases
    .map((r) => (r.year ? parseInt(r.year) : null))
    .filter((y): y is number => y !== null && !isNaN(y));

  if (years.length > 0) {
    const earliestYear = Math.min(...years);
    const ageBias = Math.max(0, new Date().getFullYear() - earliestYear);
    score += Math.min(10, ageBias / 5); // Up to +10 for very old songs
  }

  // Bonus for canonical 80s US hits (single-word exact matches, studio album, 1980-1990, US release)
  const isSingleWordQuery = qTitle.split(" ").length === 1;
  const isExactTitleMatch = recTitle === qTitle;

  if (isSingleWordQuery && isExactTitleMatch) {
    const isStudio = isStudioRecording(recording);
    const hasAlbum = releases.some(
      (r) => r.primaryType?.toLowerCase() === "album",
    );
    const isStudioAlbum = isStudio && hasAlbum;

    const hasReleaseYearBetween1980And1990 = years.some(
      (y) => y >= 1980 && y <= 1990,
    );
    const hasUSRelease = releases.some(
      (r) => r.country?.toUpperCase() === "US",
    );

    if (isStudioAlbum && hasReleaseYearBetween1980And1990 && hasUSRelease) {
      score += 40;
    }
  }

  // MusicBrainz score (light weight)
  if (recording.score !== null && recording.score !== undefined) {
    score += recording.score / 10; // Scale down MB score
  }

  return score;
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
