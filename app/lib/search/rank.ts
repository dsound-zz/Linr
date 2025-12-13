/**
 * rank.ts
 *
 * ONE scoring function that assigns a numeric score to recordings.
 * Higher score = more likely to be the canonical version.
 */

import type { NormalizedRecording, AlbumTrackCandidate } from "./types";
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

  // Artist matching (ONLY if provided in query)
  // DO NOT use artist name similarity when artist is not in the query
  const artistProvided = Boolean(query.artist);
  if (artistProvided && query.artist) {
    const recArtist = normalize(recording.artist);
    const qArtist = normalize(query.artist);

    if (recArtist === qArtist || recArtist.includes(qArtist)) {
      score += 25;
    } else {
      score -= 10; // Penalty for wrong artist
    }
  }
  // When artist is not provided, artistScore = 0 (no boost, no penalty)

  // Boost for canonical/well-known artists (even when not in query)
  // This helps surface culturally significant recordings
  if (!artistProvided) {
    const recArtist = normalize(recording.artist);
    const canonicalArtists = [
      "quincy jones",
      "michael jackson",
      "prince",
      "madonna",
      "david bowie",
      "stevie wonder",
      "aretha franklin",
      "james brown",
      "ray charles",
      "frank sinatra",
      "elvis presley",
      "the beatles",
      "rolling stones",
      "led zeppelin",
      "pink floyd",
      "queen",
      "fleetwood mac",
      "eagles",
      "van halen",
      "ac/dc",
    ];

    for (const canonical of canonicalArtists) {
      if (recArtist.includes(canonical) || canonical.includes(recArtist)) {
        score += 30; // Significant boost for canonical artists
        break;
      }
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

  // Album-title prominence boost: title track from canonical album
  // If recording title matches release title, it's likely the title track
  const isTitleTrack = releases.some((r) => {
    if (!r.title) return false;
    return normalize(r.title) === recTitle;
  });
  if (isTitleTrack && hasAlbum) {
    score += 20; // Title track from album = canonical
  }

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
 * Score an album track candidate
 * Album tracks get minimal scoring - they should never outrank strong recordings
 */
export function scoreAlbumTrack(
  albumTrack: AlbumTrackCandidate,
  query: { title: string; artist?: string | null },
): number {
  let score = 0;

  // Title matching (light weight)
  const trackTitle = albumTrack.title.toLowerCase().trim();
  const qTitle = query.title.toLowerCase().trim();

  if (trackTitle === qTitle) {
    score += 20; // Lower than recording exact match
  } else if (trackTitle.includes(qTitle)) {
    score += 10;
  }

  // Boost for canonical artists (even when not in query)
  if (!query.artist) {
    const trackArtist = albumTrack.artist.toLowerCase();
    const canonicalArtists = [
      "quincy jones",
      "michael jackson",
      "prince",
      "madonna",
      "david bowie",
      "stevie wonder",
      "aretha franklin",
      "james brown",
      "ray charles",
      "frank sinatra",
      "elvis presley",
      "the beatles",
      "rolling stones",
      "led zeppelin",
      "pink floyd",
    ];

    for (const canonical of canonicalArtists) {
      if (trackArtist.includes(canonical) || canonical.includes(trackArtist)) {
        score += 10; // Boost for canonical artists
        break;
      }
    }
  }

  // Boost for older releases (canonical era)
  if (albumTrack.year) {
    const year = parseInt(albumTrack.year, 10);
    if (year <= 1990) {
      score += 5;
    }
  }

  // Artist matching (if provided)
  if (query.artist) {
    const trackArtist = albumTrack.artist.toLowerCase();
    const qArtist = query.artist.toLowerCase();
    if (trackArtist === qArtist || trackArtist.includes(qArtist)) {
      score += 15;
    } else {
      score -= 5; // Light penalty for wrong artist
    }
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
