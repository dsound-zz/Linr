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
 *
 * SINGLE-WORD QUERY POLICY:
 * Single-word queries (e.g., "jump") are inherently ambiguous.
 * We do NOT require word-count equality - candidates with extra words are allowed.
 * We prefer exact title matches, studio recordings, and primary artists,
 * but let scoring decide rather than using boolean filters that eliminate candidates.
 * This prevents oscillation between "too strict" (no results) and "too loose" (spam).
 */

import { parseUserQuery } from "../parseQuery";
import {
  searchByTitle,
  searchByTitleAndArtist,
  searchExactRecordingTitle,
  searchByTitleAndArtistName,
} from "./search";
import { normalizeRecordings } from "./normalize";
import { getReleaseTrackCandidates } from "./releaseTrackFallback";
import {
  isExactOrPrefixTitleMatch,
  isStudioRecording,
  isAlbumOrSingleRelease,
} from "./filters";
import { scoreRecording, scoreAlbumTrack } from "./rank";
import { canonicalPick } from "./canonical";
import { searchWikipediaTrack } from "./wikipedia";
import { rerankCandidates } from "./openai";
import type {
  NormalizedRecording,
  SearchResponse,
  CanonicalResult,
  AlbumTrackCandidate,
} from "./types";
import type { MusicBrainzRecording } from "../types";

/**
 * Apply canonical bias to recordings for single-word queries
 *
 * NOTE: This function is still needed for single-word queries where album tracks
 * are not searched (album tracks are only searched for multi-word queries).
 * It boosts recordings based on Wikipedia presence and release prominence.
 *
 * For multi-word queries, album_track entities handle canonical artists directly,
 * making this function less critical in those cases.
 */
async function applyCanonicalBias(
  recordings: NormalizedRecording[],
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

const CONFIDENCE_THRESHOLD = 30; // Minimum score to consider confident
const CANONICAL_SCORE_GAP = 5; // Minimum score gap required for canonical mode

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

    // Release-track and album-title-inferred recordings skip studio/album filters
    // They come from album tracklists/titles and may not have complete metadata
    if (
      rec.source !== "release-track" &&
      rec.source !== "album-title-inferred"
    ) {
      // Must be studio recording
      if (!isStudioRecording(rec)) return false;

      // Must have album or single release
      if (!isAlbumOrSingleRelease(rec)) return false;
    }

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
 * Check if query looks like a song title (not a live/remix/version query)
 */
function queryLooksLikeSongTitle(title: string): boolean {
  return title.length >= 3 && !title.match(/live|remix|version/i);
}

/**
 * Resolve entity type for a canonical result based on source and context
 * Step 6.5: Entity Resolution - makes explicit what type of entity we're returning
 */
function resolveEntityType(result: CanonicalResult): CanonicalResult {
  // MusicBrainz results are recordings
  if (result.source.startsWith("musicbrainz")) {
    return { ...result, entityType: "recording" };
  }

  // Wikipedia results need context-based resolution
  if (result.source === "wikipedia") {
    if (result.releaseTitle) {
      return {
        ...result,
        entityType: "album_track",
        explanation: "Identified via album context",
      };
    }

    return {
      ...result,
      entityType: "song_inferred",
      explanation:
        "Culturally canonical song, not consistently modeled as a recording",
    };
  }

  return result;
}

/**
 * Main pipeline function
 * Returns either canonical (single result) or ambiguous (multiple results) based on query confidence
 */
export async function searchCanonicalSong(
  query: string,
  debug?: false,
): Promise<SearchResponse | null>;
export async function searchCanonicalSong(
  query: string,
  debug: true,
): Promise<{ response: SearchResponse | null; debugInfo: DebugInfo }>;
export async function searchCanonicalSong(
  query: string,
  debug: boolean = false,
): Promise<
  | SearchResponse
  | null
  | { response: SearchResponse | null; debugInfo: DebugInfo }
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

  // Step 2: Search MusicBrainz (with timing)
  const searchStartTime = performance.now();
  if (artist) {
    // Artist provided - use scoped search
    rawRecordings = await searchByTitleAndArtist(title, artist);
    recordings = normalizeRecordings(rawRecordings);
    const searchTime = performance.now() - searchStartTime;
    if (debugInfo) {
      debugInfo.stages.recordings = recordings;
      debugInfo.stages.searchTiming = { ms: searchTime };
    }
  } else {
    // Title only - for single-word queries, try exact-title search first
    if (isSingleWordQuery) {
      const exactRecordings = await searchExactRecordingTitle(title);
      if (exactRecordings.length > 0) {
        rawRecordings = exactRecordings;
        recordings = normalizeRecordings(exactRecordings);
        const searchTime = performance.now() - searchStartTime;
        if (debugInfo) {
          debugInfo.stages.recordings = recordings;
          debugInfo.stages.searchTiming = { ms: searchTime };
        }
      } else {
        // Fall back to broad search if exact search returns nothing
        rawRecordings = await searchByTitle(title);
        recordings = normalizeRecordings(rawRecordings);
        const searchTime = performance.now() - searchStartTime;
        if (debugInfo) {
          debugInfo.stages.recordings = recordings;
          debugInfo.stages.searchTiming = { ms: searchTime };
        }
      }
    } else {
      // Multi-word queries - use broad search
      rawRecordings = await searchByTitle(title);
      recordings = normalizeRecordings(rawRecordings);
      const searchTime = performance.now() - searchStartTime;
      if (debugInfo) {
        debugInfo.stages.recordings = recordings;
        debugInfo.stages.searchTiming = { ms: searchTime };
      }
    }
  }

  // Never return Wikipedia results if we have MusicBrainz recordings
  // Wikipedia is only for validation, not replacement
  if (recordings.length === 0) {
    if (debug && debugInfo) {
      return { response: null, debugInfo };
    }
    return null;
  }

  // Step 2.5: Expand candidates with prominent artists for ambiguous single-word queries
  // This runs in parallel for performance
  if (isSingleWordQuery && !artist) {
    const expansionStartTime = performance.now();
    const expandedRawRecordings = await expandWithProminentArtists(
      title,
      rawRecordings,
    );
    const expansionTime = performance.now() - expansionStartTime;

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
          timing: { ms: expansionTime },
        };
      }
    }
  }

  // Step 2.75: Release-track fallback for multi-word titles
  // Only when: no artist, 2+ words
  // This catches songs that exist primarily as release tracks (e.g., "The Dude" by Quincy Jones)
  // Keep album tracks as a separate entity type - do NOT merge with recordings
  const titleWordCount = title.trim().split(/\s+/).length;
  let albumTrackCandidates: AlbumTrackCandidate[] = [];

  if (!artist && titleWordCount >= 2) {
    const fallbackStartTime = performance.now();
    albumTrackCandidates = await getReleaseTrackCandidates({
      title,
      artist: null,
    });
    const fallbackTime = performance.now() - fallbackStartTime;

    if (albumTrackCandidates.length > 0 && debugInfo) {
      debugInfo.stages.releaseTrackFallback = {
        count: albumTrackCandidates.length,
        timing: { ms: fallbackTime },
      };
    }
  }

  // Keep recordings and album tracks separate - do NOT merge
  // Recordings will go through filtering and scoring
  // Album tracks will be scored separately and included in ambiguous results only

  // Step 3: Apply strict filters
  const filterStartTime = performance.now();
  let filtered = applyFilters(recordings, title);
  const filterTime = performance.now() - filterStartTime;

  if (debugInfo) {
    debugInfo.stages.filtered = filtered;
    debugInfo.stages.filterTiming = { ms: filterTime };
  }

  // If filters removed everything, relax slightly (keep title match requirement)
  // DO NOT eliminate all candidates - always allow some through for ranking
  if (filtered.length === 0) {
    filtered = recordings.filter((rec) =>
      isExactOrPrefixTitleMatch(rec, title),
    );
    if (debugInfo) {
      debugInfo.stages.filterRelaxed = {
        reason: "Filters would eliminate all candidates",
        after: filtered.length,
      };
    }
  }

  // If still empty, use all recordings (let ranking handle it)
  if (filtered.length === 0) {
    filtered = recordings;
    if (debugInfo) {
      debugInfo.stages.filterBypassed = {
        reason: "No candidates after filter relaxation - using all recordings",
        count: recordings.length,
      };
    }
  }

  // Word-count filter: DISABLED for single-word queries per policy
  // Single-word queries are ambiguous - we allow candidates with extra words
  // and let scoring prefer exact matches rather than filtering them out
  if (!artist && !isSingleWordQuery) {
    // Multi-word queries: apply word-count filter
    const queryWordCount = normalize(title)
      .split(/\s+/)
      .filter((w) => w.length > 0).length;
    const beforeWordCountFilter = filtered.length;

    // Preserve release-track fallback candidates and canonical artists
    // Track which recordings came from release-track fallback
    const releaseTrackFallbackArtists = new Set<string>();
    if (debugInfo?.stages.releaseTrackFallback) {
      // We can't easily track which specific recordings came from fallback,
      // but we can preserve canonical artists
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
      for (const artist of canonicalArtists) {
        releaseTrackFallbackArtists.add(artist);
      }
    }

    filtered = filtered.filter((rec) => {
      const recTitleWords = normalize(rec.title)
        .split(/\s+/)
        .filter((w) => w.length > 0);
      const wordCountMatch = recTitleWords.length === queryWordCount;

      // Preserve canonical artists even if word count doesn't match exactly
      if (!wordCountMatch) {
        const recArtist = normalize(rec.artist);
        for (const canonical of releaseTrackFallbackArtists) {
          if (recArtist.includes(canonical) || canonical.includes(recArtist)) {
            return true; // Preserve canonical artists
          }
        }
      }

      return wordCountMatch;
    });

    if (debugInfo) {
      debugInfo.stages.wordCountFilter = {
        queryWordCount,
        before: beforeWordCountFilter,
        after: filtered.length,
        skipped: false,
      };
    }

    // If filter removed all candidates, skip it
    if (filtered.length === 0) {
      filtered = recordings.filter((rec) =>
        isExactOrPrefixTitleMatch(rec, title),
      );
      if (debugInfo) {
        const existing = debugInfo.stages.wordCountFilter as
          | Record<string, unknown>
          | undefined;
        debugInfo.stages.wordCountFilter = {
          ...(existing || {}),
          skipped: true,
          reason: "Would eliminate all candidates",
          after: filtered.length,
        };
      }
    }
  } else if (isSingleWordQuery && debugInfo) {
    // Document that word-count filter is skipped for single-word queries
    debugInfo.stages.wordCountFilter = {
      skipped: true,
      reason:
        "Single-word queries allow candidates with extra words per policy",
    };
  }

  // Step 3.5: Apply canonical bias for ambiguous single-word queries
  if (isSingleWordQuery && !artist && filtered.length > 10) {
    filtered = await applyCanonicalBias(filtered);
    if (debugInfo) {
      debugInfo.stages.canonicalBias = {
        candidatesCount: filtered.length,
        biasApplied: true,
      };
    }
  }

  // Step 4: Score and sort recordings
  const scoreStartTime = performance.now();
  const scored = scoreAndSort(filtered, { title, artist });
  const scoreTime = performance.now() - scoreStartTime;

  if (debugInfo) {
    debugInfo.stages.scored = scored;
    debugInfo.stages.scoreTiming = { ms: scoreTime };
  }

  // Step 4.5: Score album tracks separately
  let scoredAlbumTracks: Array<AlbumTrackCandidate & { score: number }> = [];
  if (albumTrackCandidates.length > 0) {
    scoredAlbumTracks = albumTrackCandidates
      .map((at) => ({
        ...at,
        score: scoreAlbumTrack(at, { title, artist }),
      }))
      .sort((a, b) => b.score - a.score);
    if (debugInfo) {
      debugInfo.stages.albumTracksScored = scoredAlbumTracks;
    }
  }

  // Step 5: Pick top recording results (already sorted by score)
  let results = canonicalPick(scored, 5); // Get top 5
  if (debugInfo) debugInfo.stages.results = results;
  if (results.length === 0) {
    if (debug && debugInfo) {
      return { response: null, debugInfo };
    }
    return null;
  }

  // Step 5.5: Late-stage Wikipedia fallback
  // Only when: MusicBrainz returns results, none match canonical artists, no explicit artist query
  // AND query looks like a song title (not live/remix/version)
  const artistProvided = Boolean(artist);
  const topResult = results[0];
  const confidence = topResult.confidenceScore;

  const allowWikipediaInference =
    !artistProvided &&
    results.length > 0 &&
    confidence < 95 &&
    queryLooksLikeSongTitle(title);

  if (allowWikipediaInference) {
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

    // Check if any result matches a canonical artist OR if album tracks were found
    // Album tracks handle canonical artists (e.g., Quincy Jones), so Wikipedia inference
    // is only needed if no canonical artist found in recordings AND no album tracks exist
    const hasCanonicalArtist = results.some((result) => {
      const normalizedArtist = normalize(result.artist);
      return canonicalArtists.some(
        (canonical) =>
          normalizedArtist.includes(canonical) ||
          canonical.includes(normalizedArtist),
      );
    });

    // Only try Wikipedia inference if:
    // - No canonical artist found in recordings
    // - No album tracks were found (album tracks handle canonical artists)
    // This prevents redundant Wikipedia lookups when album tracks already provide the answer
    if (!hasCanonicalArtist && albumTrackCandidates.length === 0) {
      const wikiStartTime = performance.now();
      const wikiResult = await searchWikipediaTrack(title);

      if (wikiResult && wikiResult.artist !== "Unknown artist") {
        // Create a Wikipedia-inferred CanonicalResult with lower confidence
        // Entity type will be resolved in Step 6.5
        const wikiCanonical: CanonicalResult = {
          id: wikiResult.id,
          title: wikiResult.title,
          artist: wikiResult.artist,
          year: wikiResult.year,
          releaseTitle: null,
          entityType: "song_inferred", // Will be resolved properly in Step 6.5
          confidenceScore: 50, // Lower than typical MusicBrainz scores (typically 70+)
          source: "wikipedia",
        };

        // Add to results (sorted by confidence, so it won't rank above confident MB results)
        results = [...results, wikiCanonical].sort(
          (a, b) => b.confidenceScore - a.confidenceScore,
        );

        const wikiTime = performance.now() - wikiStartTime;
        if (debugInfo) {
          debugInfo.stages.wikipediaInference = {
            triggered: true,
            candidate: wikiCanonical,
            timing: { ms: wikiTime },
          };
        }
      } else if (debugInfo) {
        debugInfo.stages.wikipediaInference = {
          triggered: true,
          candidate: null,
          reason: wikiResult
            ? "Wikipedia returned unknown artist"
            : "Wikipedia search failed",
        };
      }
    }
  }

  // Step 6: Resolve entity types for all results
  // Makes explicit what type of entity each result represents
  results = results.map(resolveEntityType);

  // Calculate entity type counts for logging and decision reasoning
  const recordingCount = results.filter(
    (r) => r.entityType === "recording",
  ).length;
  const albumTrackCount = results.filter(
    (r) => r.entityType === "album_track",
  ).length;
  const songInferredCount = results.filter(
    (r) => r.entityType === "song_inferred",
  ).length;

  // Step 6.5: Entity Resolution Logging
  // Track entity type distribution and decision reasoning
  if (debugInfo) {
    // Determine query type
    const queryType = artist
      ? "artist_provided"
      : isSingleWordQuery
        ? "title_only_single_word"
        : "title_only_multi_word";

    // Group results by entity type
    const entityGroups = new Map<
      CanonicalResult["entityType"],
      CanonicalResult[]
    >();
    for (const result of results) {
      const group = entityGroups.get(result.entityType) || [];
      group.push(result);
      entityGroups.set(result.entityType, group);
    }

    // Build entity candidates array
    const entityCandidates: Array<{
      entityType: CanonicalResult["entityType"];
      count: number;
      topArtist?: string;
      artist?: string;
      source?: string;
    }> = [];

    for (const [entityType, groupResults] of entityGroups.entries()) {
      const candidate: {
        entityType: CanonicalResult["entityType"];
        count: number;
        topArtist?: string;
        artist?: string;
        source?: string;
      } = {
        entityType,
        count: groupResults.length,
      };

      // For recording entities, show top artist
      if (entityType === "recording" && groupResults.length > 0) {
        candidate.topArtist = groupResults[0].artist;
      }

      // For album_track or song_inferred, show artist and source
      if (
        (entityType === "album_track" || entityType === "song_inferred") &&
        groupResults.length > 0
      ) {
        candidate.artist = groupResults[0].artist;
        candidate.source = groupResults[0].source;
      }

      entityCandidates.push(candidate);
    }

    // Determine assumed intent based on entity distribution
    let assumedIntent: "song" | "recording" | "album_track";
    if (
      recordingCount > albumTrackCount &&
      recordingCount > songInferredCount
    ) {
      assumedIntent = "recording";
    } else if (albumTrackCount > songInferredCount) {
      assumedIntent = "album_track";
    } else {
      assumedIntent = "song";
    }

    debugInfo.stages.entityResolution = {
      queryType,
      assumedIntent,
      entityCandidates,
      albumTracksFound: albumTrackCandidates.length,
      albumTracksScored: scoredAlbumTracks.length,
    };
  }

  // Step 7: Decide response mode (canonical vs ambiguous)
  // Use the resolved results (entity types are now explicit)
  // Note: results[0] may be updated during Wikipedia validation, so we reference it directly
  const confidenceAfterResolution = results[0].confidenceScore;

  // Compute score gap vs runner-up
  const scoreGap =
    results.length > 1
      ? results[0].confidenceScore - results[1].confidenceScore
      : Infinity;

  if (debugInfo) {
    debugInfo.stages.confidence = confidenceAfterResolution;
    debugInfo.stages.scoreGap = scoreGap;
  }

  // Decide response mode:
  // Return canonical ONLY if:
  //   - Artist provided in query, OR
  //   - Single-word query with score gap >= CANONICAL_SCORE_GAP
  // Multi-word title-only queries MUST return ambiguous mode
  // Decide canonical mode:
  // - Artist provided: always canonical
  // - Single-word with multiple results: canonical only if score gap >= threshold
  // - Single-word with single result: canonical
  const shouldReturnCanonical =
    artistProvided ||
    (isSingleWordQuery && results.length === 1) ||
    (isSingleWordQuery &&
      results.length > 1 &&
      scoreGap >= CANONICAL_SCORE_GAP);

  // Convert scored album tracks to CanonicalResult format
  const albumTrackResults: CanonicalResult[] = scoredAlbumTracks
    .slice(0, 2) // Top 1-2 album tracks
    .map((at) => ({
      id: `album-track-${at.releaseId}`,
      title: at.title,
      artist: at.artist,
      year: at.year,
      releaseTitle: at.releaseTitle,
      entityType: "album_track" as const,
      confidenceScore: at.score,
      source: "musicbrainz" as const,
      explanation: "Identified via album context",
    }));

  // Enforce ambiguity for multi-word title-only queries
  // This prevents over-canonicalization when artist is not provided
  // Include album tracks in ambiguous results
  if (!artistProvided && !isSingleWordQuery) {
    // Combine recordings and album tracks for ambiguous results
    // Album tracks should appear after recordings but within top results
    const maxResults = 5;
    const recordingsIncluded = Math.min(results.length, 3);
    const albumTracksIncluded = Math.min(
      albumTrackResults.length,
      maxResults - recordingsIncluded,
    );
    const combinedResults = [
      ...results.slice(0, recordingsIncluded),
      ...albumTrackResults.slice(0, albumTracksIncluded),
    ]
      .slice(0, maxResults)
      .sort((a, b) => b.confidenceScore - a.confidenceScore);

    const response: SearchResponse = {
      mode: "ambiguous",
      results: combinedResults,
    };

    if (debugInfo) {
      debugInfo.stages.responseMode = "ambiguous";
      debugInfo.stages.ambiguousResultsCount = combinedResults.length;
      debugInfo.stages.albumTracksIncluded = albumTracksIncluded;
      debugInfo.stages.albumTracksTotal = scoredAlbumTracks.length;

      // Final selection debug summary
      debugInfo.stages.finalSelection = {
        maxResults,
        recordingsIncluded,
        albumTracksIncluded,
        albumTracksTotal: scoredAlbumTracks.length,
        reason:
          albumTracksIncluded > 0
            ? `Included ${albumTracksIncluded} album track(s) in ambiguous results for multi-word title-only query`
            : "No album tracks included - recordings only",
      };

      debugInfo.stages.ambiguityReason =
        "Multi-word title-only query - requires explicit artist for canonical result";

      // Update entity resolution with decision
      if (debugInfo.stages.entityResolution) {
        const entityRes = debugInfo.stages.entityResolution as Record<
          string,
          unknown
        >;
        entityRes.decision = "ambiguous";
        entityRes.reason =
          recordingCount > 0
            ? "Recording entities dominate without artist disambiguation"
            : "Mixed entity types require explicit artist for canonical result";
      }
    }

    if (debug && debugInfo) {
      return { response, debugInfo };
    }
    return response;
  }

  if (shouldReturnCanonical) {
    // Single canonical result
    // Do NOT include album tracks in canonical mode
    if (debugInfo) {
      debugInfo.stages.finalSelection = {
        maxResults: 1,
        recordingsIncluded: 1,
        albumTracksIncluded: 0,
        albumTracksTotal: scoredAlbumTracks.length,
        reason: "Canonical mode - single recording result only",
      };
    }

    // Apply Wikipedia/OpenAI validation only if needed
    if (confidenceAfterResolution < CONFIDENCE_THRESHOLD && !artistProvided) {
      const wikiResult = await searchWikipediaTrack(
        artist ? `${title} ${artist}` : title,
      );

      if (wikiResult) {
        const normalizedWikiTitle = normalize(results[0].title ?? "");
        const normalizedWikiQuery = normalize(wikiResult.title ?? "");

        if (
          normalizedWikiTitle === normalizedWikiQuery ||
          normalizedWikiTitle.includes(normalizedWikiQuery)
        ) {
          // Update source and re-resolve entity type
          const updated = {
            ...results[0],
            source: "musicbrainz+wikipedia" as const,
          };
          const resolved = resolveEntityType(updated);
          results[0] = resolved;
        }
      }

      // OpenAI rerank only if scores are very close
      if (results.length > 1) {
        const scoreDiff =
          results[0].confidenceScore - results[1].confidenceScore;
        if (scoreDiff < 10) {
          const rerankStartTime = performance.now();
          const reranked = await rerankCandidates(results.slice(0, 5), query);
          const rerankTime = performance.now() - rerankStartTime;

          if (debugInfo) {
            debugInfo.stages.reranked = reranked;
            debugInfo.stages.rerankTiming = { ms: rerankTime };
          }
          if (reranked.length > 0) {
            // Ensure entity type is resolved for reranked result
            const finalResult = resolveEntityType(reranked[0]);
            const response: SearchResponse = {
              mode: "canonical",
              result: finalResult,
            };
            if (debug && debugInfo) {
              return { response, debugInfo };
            }
            return response;
          }
        }
      }
    }

    const response: SearchResponse = {
      mode: "canonical",
      result: results[0],
    };

    if (debugInfo) {
      debugInfo.candidates.selected = {
        title: results[0].title,
        artist: results[0].artist,
        score: results[0].confidenceScore,
        entityType: results[0].entityType,
      };
      debugInfo.stages.responseMode = "canonical";

      // Update entity resolution with decision
      if (debugInfo.stages.entityResolution) {
        const entityRes = debugInfo.stages.entityResolution as Record<
          string,
          unknown
        >;
        entityRes.decision = "canonical";
        entityRes.reason = artistProvided
          ? "Explicit artist provided - canonical result"
          : results.length === 1
            ? "Single result available"
            : `Score gap (${scoreGap}) meets threshold (${CANONICAL_SCORE_GAP})`;
      }
    }

    if (debug && debugInfo) {
      return { response, debugInfo };
    }
    return response;
  } else {
    // Ambiguous query - return top 5 results
    // This branch handles:
    // - Multi-word title-only queries (always ambiguous)
    // - Single-word queries with close scores (score gap < CANONICAL_SCORE_GAP)
    // Album tracks are NOT included here (only in multi-word title-only branch above)
    const maxResults = 5;
    const response: SearchResponse = {
      mode: "ambiguous",
      results: results.slice(0, maxResults),
    };

    if (debugInfo) {
      debugInfo.stages.responseMode = "ambiguous";
      debugInfo.stages.ambiguousResultsCount = Math.min(
        results.length,
        maxResults,
      );

      // Final selection debug summary
      const reason = isSingleWordQuery
        ? `Single-word query with close scores (gap: ${scoreGap} < ${CANONICAL_SCORE_GAP})`
        : "Multi-word title-only query - requires explicit artist for canonical result";

      debugInfo.stages.finalSelection = {
        maxResults,
        recordingsIncluded: Math.min(results.length, maxResults),
        albumTracksIncluded: 0,
        albumTracksTotal: scoredAlbumTracks.length,
        reason,
      };

      // Update entity resolution with decision
      if (debugInfo.stages.entityResolution) {
        const entityRes = debugInfo.stages.entityResolution as Record<
          string,
          unknown
        >;
        entityRes.decision = "ambiguous";
        entityRes.reason = isSingleWordQuery
          ? `Score gap (${scoreGap}) below threshold (${CANONICAL_SCORE_GAP})`
          : recordingCount > 0
            ? "Recording entities dominate without artist disambiguation"
            : "Mixed entity types require explicit artist for canonical result";
      }
    }

    if (debug && debugInfo) {
      return { response, debugInfo };
    }
    return response;
  }
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
