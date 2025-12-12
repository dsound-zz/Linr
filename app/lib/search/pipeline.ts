/**
 * pipeline.ts
 *
 * Main pipeline orchestrator for Canonical Song Search
 *
 * Flow:
 * 1. Parse user query into title + optional artist
 * 2. If artist provided: searchByTitleAndArtist -> normalize -> filters -> rank -> canonicalPick
 * 3. Else (title only): searchByTitle -> normalize -> filters -> rank -> canonicalPick
 * 4. If confidence < threshold: try Wikipedia validation OR OpenAI rerank
 * 5. Return canonical result
 */

import { parseUserQuery } from "../parseQuery";
import {
  searchByTitle,
  searchByTitleAndArtist,
  searchExactRecordingTitle,
  searchReleaseByTitle,
  searchByTitleAndArtistName,
} from "./search";
import { normalizeRecordings } from "./normalize";
import {
  isExactOrPrefixTitleMatch,
  isStudioRecording,
  isAlbumOrSingleRelease,
} from "./filters";
import { scoreRecording } from "./rank";
import { canonicalPick } from "./canonical";
import { searchWikipediaTrack } from "./wikipedia";
import { rerankCandidates } from "./openai";
import type { CanonicalResult, NormalizedRecording } from "./types";
import type { MusicBrainzRecording } from "../types";

/**
 * Expand candidates by searching with prominent artists
 * Used for ambiguous single-word queries to surface canonical songs
 */
async function expandWithProminentArtists(
  title: string,
  existingRecordings: MusicBrainzRecording[],
): Promise<MusicBrainzRecording[]> {
  // Small cached list of prominent artists across genres
  const prominentArtists = [
    // Rock/Pop
    "Van Halen",
    "The Beatles",
    "Michael Jackson",
    "Madonna",
    "Prince",
    "David Bowie",
    "Elton John",
    "Queen",
    "Led Zeppelin",
    "Pink Floyd",
    "The Rolling Stones",
    "Bob Dylan",
    "Bruce Springsteen",
    "U2",
    "Radiohead",
    // Pop/Contemporary
    "Taylor Swift",
    "Adele",
    "Beyoncé",
    "Rihanna",
    "Justin Timberlake",
    "Bruno Mars",
    "Ed Sheeran",
    "Ariana Grande",
    // Hip-Hop/R&B
    "Eminem",
    "Jay-Z",
    "Kanye West",
    "Drake",
    "Kendrick Lamar",
    "The Weeknd",
  ];

  // Search with each prominent artist in parallel
  const expansionSearches = await Promise.all(
    prominentArtists.map((artist) =>
      searchByTitleAndArtistName(title, artist).catch(() => []),
    ),
  );

  // Merge results, dedupe by recording MBID
  const seen = new Set<string>();
  const merged: MusicBrainzRecording[] = [...existingRecordings];

  // Mark existing recordings as seen
  for (const rec of existingRecordings) {
    if (rec.id) seen.add(rec.id);
  }

  // Add new recordings from expansion searches
  for (const results of expansionSearches) {
    for (const rec of results) {
      if (rec.id && !seen.has(rec.id)) {
        seen.add(rec.id);
        merged.push(rec);
      }
    }
  }

  return merged;
}

/**
 * Apply canonical bias to recordings based on prominence signals
 * Only boosts, never filters
 */
async function applyCanonicalBias(
  recordings: NormalizedRecording[],
  queryTitle: string,
): Promise<NormalizedRecording[]> {
  if (recordings.length === 0) return recordings;

  // Check Wikipedia for each candidate (in parallel, limit to top 20 for performance)
  const candidatesToCheck = recordings.slice(0, 20);
  const wikiChecks = await Promise.all(
    candidatesToCheck.map(async (rec) => {
      const query = `${rec.title} ${rec.artist}`;
      const wikiResult = await searchWikipediaTrack(query);
      return { rec, hasWikipedia: wikiResult !== null };
    }),
  );

  // Calculate prominence scores
  return recordings.map((rec) => {
    let bias = 0;

    // Wikipedia presence boost
    const wikiCheck = wikiChecks.find((w) => w.rec.id === rec.id);
    if (wikiCheck?.hasWikipedia) {
      bias += 15; // Wikipedia page exists = mainstream recognition
    }

    // Release prominence: many releases = canonical
    const releaseCount = rec.releases.length;
    if (releaseCount > 5) {
      bias += 10; // Many releases = reissues/compilations = canonical
    } else if (releaseCount > 2) {
      bias += 5;
    }

    // Release year span: long career = prominence
    const years = rec.releases
      .map((r) => (r.year ? parseInt(r.year) : null))
      .filter((y): y is number => y !== null && !isNaN(y));
    if (years.length > 0) {
      const yearSpan = Math.max(...years) - Math.min(...years);
      if (yearSpan > 10) {
        bias += 5; // Long career span = canonical artist
      }
    }

    // Album releases: albums > singles for canonical songs
    const albumCount = rec.releases.filter(
      (r) => r.primaryType?.toLowerCase() === "album",
    ).length;
    if (albumCount > 2) {
      bias += 5; // Multiple album releases = canonical
    }

    // Add bias to existing score (or create score if null)
    return {
      ...rec,
      score: (rec.score ?? 0) + bias,
    };
  });
}

const CONFIDENCE_THRESHOLD = 30; // Minimum score to consider confident

interface DebugInfo {
  stages: Record<string, unknown>;
  candidates: Record<string, unknown>;
}

/**
 * Apply strict filters to normalized recordings
 */
function applyFilters(
  recordings: NormalizedRecording[],
  queryTitle: string,
): NormalizedRecording[] {
  return recordings.filter((rec) => {
    // Title must match exactly or be a prefix
    if (!isExactOrPrefixTitleMatch(rec, queryTitle)) return false;

    // Must be studio recording
    if (!isStudioRecording(rec)) return false;

    // Must have album or single release
    if (!isAlbumOrSingleRelease(rec)) return false;

    // Prefer US/worldwide releases (but don't filter out completely)
    // This is handled in scoring, not filtering

    return true;
  });
}

/**
 * Score and sort recordings
 */
function scoreAndSort(
  recordings: NormalizedRecording[],
  query: { title: string; artist?: string | null },
): NormalizedRecording[] {
  return recordings
    .map((rec) => {
      const computedScore = scoreRecording(rec, query);
      return { ...rec, score: computedScore };
    })
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
}

/**
 * Main pipeline function
 */
export async function searchCanonicalSong(
  query: string,
  debug?: false,
): Promise<CanonicalResult | null>;
export async function searchCanonicalSong(
  query: string,
  debug: true,
): Promise<{ result: CanonicalResult | null; debugInfo: DebugInfo }>;
export async function searchCanonicalSong(
  query: string,
  debug: boolean = false,
): Promise<
  | CanonicalResult
  | null
  | { result: CanonicalResult | null; debugInfo: DebugInfo }
> {
  // Step 1: Parse query
  const { title, artist } = parseUserQuery(query);
  const isSingleWordQuery = title.trim().split(/\s+/).length === 1;

  const debugInfo: DebugInfo | null = debug
    ? {
        stages: {},
        candidates: {},
      }
    : null;

  if (debugInfo) debugInfo.stages.parsed = { title, artist };

  let recordings: NormalizedRecording[] = [];
  let rawRecordings: MusicBrainzRecording[] = [];

  // Step 2: Search MusicBrainz
  if (artist) {
    // Artist provided - use scoped search
    rawRecordings = await searchByTitleAndArtist(title, artist);
    recordings = normalizeRecordings(rawRecordings);
    if (debugInfo) debugInfo.stages.recordings = recordings;
  } else {
    // Title only - for single-word queries, try exact-title search first
    if (isSingleWordQuery) {
      const exactRecordings = await searchExactRecordingTitle(title);
      if (exactRecordings.length > 0) {
        rawRecordings = exactRecordings;
        recordings = normalizeRecordings(exactRecordings);
        if (debugInfo) debugInfo.stages.recordings = recordings;
      } else {
        // Fall back to broad search if exact search returns nothing
        rawRecordings = await searchByTitle(title);
        recordings = normalizeRecordings(rawRecordings);
        if (debugInfo) debugInfo.stages.recordings = recordings;
      }
    } else {
      // Multi-word queries - use broad search
      rawRecordings = await searchByTitle(title);
      recordings = normalizeRecordings(rawRecordings);
      if (debugInfo) debugInfo.stages.recordings = recordings;
    }
  }

  // Never return Wikipedia results if we have MusicBrainz recordings
  // Wikipedia is only for validation, not replacement
  if (recordings.length === 0) {
    if (debug && debugInfo) {
      return { result: null, debugInfo };
    }
    return null;
  }

  // Step 2.5: Expand candidates with prominent artists for ambiguous single-word queries
  if (isSingleWordQuery && !artist) {
    const expandedRawRecordings = await expandWithProminentArtists(
      title,
      rawRecordings,
    );
    if (expandedRawRecordings.length > rawRecordings.length) {
      rawRecordings = expandedRawRecordings;
      recordings = normalizeRecordings(expandedRawRecordings);
      if (debugInfo) {
        debugInfo.stages.candidateExpansion = {
          before:
            rawRecordings.length -
            (expandedRawRecordings.length - rawRecordings.length),
          after: expandedRawRecordings.length,
          added: expandedRawRecordings.length - rawRecordings.length,
        };
      }
    }
  }

  // Step 3: Apply strict filters
  let filtered = applyFilters(recordings, title);
  if (debugInfo) debugInfo.stages.filtered = filtered;
  // If filters removed everything, relax slightly (keep title match requirement)
  // DO NOT eliminate all candidates - always allow some through for ranking
  if (filtered.length === 0) {
    filtered = recordings.filter((rec) =>
      isExactOrPrefixTitleMatch(rec, title),
    );
  }

  // If still empty, use all recordings (let ranking handle it)
  if (filtered.length === 0) {
    filtered = recordings;
  }

  // Filter by word count match (only when no artist provided)
  if (!artist) {
    const queryWordCount = normalize(title)
      .split(/\s+/)
      .filter((w) => w.length > 0).length;
    const beforeWordCountFilter = filtered.length;

    filtered = filtered.filter((rec) => {
      const recTitleWords = normalize(rec.title)
        .split(/\s+/)
        .filter((w) => w.length > 0);
      return recTitleWords.length === queryWordCount;
    });

    if (debugInfo) {
      debugInfo.stages.wordCountFilter = {
        queryWordCount,
        before: beforeWordCountFilter,
        after: filtered.length,
      };
    }

    // Fallback: If word-count filter removed all candidates for single-word query,
    // try exact title search, then release-based search
    if (isSingleWordQuery && filtered.length === 0) {
      // First try exact recording title search
      const exactRawRecordings = await searchExactRecordingTitle(title);
      const exactRecordings = normalizeRecordings(exactRawRecordings);

      // Filter to strict equality: normalize(rec.title) === normalize(query.title)
      const normalizedQuery = normalize(title);
      const exactMatches = exactRecordings.filter((rec) => {
        return normalize(rec.title) === normalizedQuery;
      });

      if (exactMatches.length > 0) {
        filtered = exactMatches;
        if (debugInfo) {
          debugInfo.stages.singleWordExactTitleSearch = {
            exactSearchResults: exactRawRecordings.length,
            exactMatches: exactMatches.length,
          };
        }
      } else {
        // Fallback to release-based search
        const releaseRecordings = await searchReleaseByTitle(title);
        if (releaseRecordings.length > 0) {
          const releaseNormalized = normalizeRecordings(releaseRecordings);
          // Filter to strict equality
          const releaseMatches = releaseNormalized.filter((rec) => {
            return normalize(rec.title) === normalizedQuery;
          });

          if (releaseMatches.length > 0) {
            filtered = releaseMatches;
            if (debugInfo) {
              debugInfo.stages.singleWordReleaseSearch = {
                releaseSearchResults: releaseRecordings.length,
                releaseMatches: releaseMatches.length,
              };
            }
          }
        }
      }
    }
  }

  // Step 3.5: Apply canonical bias for ambiguous single-word queries
  if (isSingleWordQuery && !artist && filtered.length > 10) {
    filtered = await applyCanonicalBias(filtered, title);
    if (debugInfo) {
      debugInfo.stages.canonicalBias = {
        candidatesCount: filtered.length,
        biasApplied: true,
      };
    }
  }

  // Step 4: Score and sort
  const scored = scoreAndSort(filtered, { title, artist });
  if (debugInfo) debugInfo.stages.scored = scored;
  // Step 5: Pick canonical result
  // scored recordings already have scores from scoreAndSort
  const results = canonicalPick(scored, 5); // Get top 5 for potential reranking
  if (debugInfo) debugInfo.stages.results = results;
  if (results.length === 0) {
    if (debug && debugInfo) {
      return { result: null, debugInfo };
    }
    return null;
  }

  // Step 6: Check confidence and optionally use Wikipedia or OpenAI
  const topResult = results[0];
  const confidence = topResult.confidenceScore;
  if (debugInfo) debugInfo.stages.confidence = confidence;
  if (confidence < CONFIDENCE_THRESHOLD || isSingleWordQuery) {
    // Low confidence or ambiguous query - try Wikipedia validation
    const wikiResult = await searchWikipediaTrack(
      artist ? `${title} ${artist}` : title,
    );

    if (wikiResult) {
      // Check if Wikipedia result matches our top result
      const normalizedWikiTitle = normalize(topResult.title);
      const normalizedWikiQuery = normalize(wikiResult.title);

      if (
        normalizedWikiTitle === normalizedWikiQuery ||
        normalizedWikiTitle.includes(normalizedWikiQuery)
      ) {
        // Wikipedia validates our result
        topResult.source = "musicbrainz+wikipedia";
        if (debugInfo) debugInfo.stages.topResult = topResult;
        if (debug && debugInfo) {
          return { result: topResult, debugInfo };
        }
        return topResult;
      }
    }

    // If multiple candidates are close in score, use OpenAI rerank
    if (results.length > 1) {
      const scoreDiff = results[0].confidenceScore - results[1].confidenceScore;
      if (scoreDiff < 10) {
        // Scores are close - rerank with OpenAI
        const reranked = await rerankCandidates(results.slice(0, 5), query);
        if (debugInfo) debugInfo.stages.reranked = reranked;
        if (reranked.length > 0) {
          if (debug && debugInfo) {
            return { result: reranked[0], debugInfo };
          }
          return reranked[0];
        }
      }
    }
  }

  if (debugInfo) {
    debugInfo.candidates.selected = topResult
      ? {
          title: topResult.title,
          artist: topResult.artist,
          score: topResult.confidenceScore,
        }
      : null;
  }

  if (debug && debugInfo) {
    return { result: topResult, debugInfo };
  }

  return topResult;
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
