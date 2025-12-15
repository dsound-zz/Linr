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
import { discoverAlbumTracks } from "./releaseTrackFallback";
import { discoverArtistScopedRecordings } from "./artistScopedRecording";
import { getPopularArtists, checkWikipediaPresence } from "./artistPopularity";
import {
  isExactOrPrefixTitleMatch,
  isStudioRecording,
  isAlbumOrSingleRelease,
} from "./filters";
import { scoreRecording, scoreAlbumTrack } from "./rank";
import { canonicalPick } from "./canonical";
import { searchWikipediaTrack } from "./wikipedia";
import { rerankCandidates } from "./openai";
import { getArtistProminence } from "./artistProminence";
import { normalizeArtistName } from "./utils/normalizeArtist";
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

  // Check Wikipedia for each candidate (in parallel).
  //
  // NOTE: This can dominate latency on mobile connections. Keep this small and rely
  // more heavily on scoring heuristics + MusicBrainz signals.
  const candidatesToCheck = recordings.slice(0, 6);
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
  // If we already have a healthy candidate set from MusicBrainz, skip expensive
  // prominent-artist expansion (this can trigger 30+ additional MB searches).
  if (existingRecordings.length >= 25) return existingRecordings;

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
 * Check if a recording is a "must-include" candidate
 * These are culturally obvious songs that should never be filtered out
 * This is separate from ranking - inclusion is guaranteed, ranking controls order
 *
 * Criteria:
 * - Exact normalized title match
 * - Studio recording
 * - Album release
 * - Artist is a group OR well-known solo act OR old enough OR multiple releases
 * - Not a repeated-word / novelty title
 */
function isMustIncludeCandidate(
  rec: NormalizedRecording,
  query: { title: string; artist?: string | null },
): boolean {
  const recTitle = normalizeTitleKey(rec.title);
  const qTitle = normalizeTitleKey(query.title);

  // 1. Must have exact normalized title match OR recording title starts with query title
  // This handles cases like "Side to Side (feat. Nicki Minaj)" matching "Side to Side"
  // Strip featured artist info: remove everything after "feat", "ft", "featuring", "with"
  const recTitleBase = recTitle
    .split(/\s+(feat|ft|featuring|with)\s+/i)[0]
    .trim();
  const titleMatches = recTitle === qTitle || recTitleBase === qTitle;
  if (!titleMatches) return false;

  // 2. Check for repeated-word / novelty titles (exclude these)
  const words = recTitle.split(" ");
  const uniqueWords = new Set(words);
  if (uniqueWords.size === 1 && words.length > 1) {
    // e.g., "jump jump jump" - exclude novelty titles
    return false;
  }

  // 3. Must have album release (primary requirement for must-include)
  // Album releases indicate canonical status regardless of remaster status
  const hasAlbum = rec.releases.some(
    (r) => r.primaryType?.toLowerCase() === "album",
  );
  if (!hasAlbum) return false;

  // 4. Studio recording check (relaxed for must-include)
  // If it has an album release and is old enough, allow it even if title has "remaster"
  // This prevents remasters from blocking culturally obvious songs
  const isStudio = isStudioRecording(rec);

  // 5. Age or release diversity check
  const years = rec.releases
    .map((r) => (r.year ? parseInt(r.year) : null))
    .filter((y): y is number => y !== null && !isNaN(y));
  const isOldEnough =
    years.length > 0 && Math.min(...years) <= new Date().getFullYear() - 15; // At least 15 years old
  const hasMultipleReleases = rec.releases.length >= 3; // Multiple releases indicates canonical

  // For must-include: if it has album release AND is old enough, allow even if not "studio"
  // This ensures remasters of old canonical songs still qualify
  if (!isStudio && !isOldEnough) return false;

  // 6. Artist heuristics (group or well-known solo act)
  const artistLower = rec.artist.toLowerCase();
  const isGroup =
    artistLower.includes("the ") ||
    artistLower.includes(" & ") ||
    artistLower.includes(" and ");

  // 7. Check artist prominence (data-driven, not hardcoded)
  // Prominent artists should be included even if not old enough or a group
  const prominence = getArtistProminence(rec);
  const isProminentArtist = prominence.score >= 30; // Same threshold as ranking

  // 8. Check for US releases + albums (indicator of mainstream/canonical status)
  // Even if not old enough, US album releases suggest canonical songs
  const hasUSAlbumRelease = rec.releases.some(
    (r) =>
      r.primaryType?.toLowerCase() === "album" &&
      r.country?.toUpperCase() === "US",
  );

  // Must satisfy: exact match + album + (studio OR old enough) + (group OR old enough OR multiple releases OR prominent artist OR US album release)
  // US album releases are a strong signal for canonical status, even for newer songs
  return (
    isGroup ||
    isOldEnough ||
    hasMultipleReleases ||
    isProminentArtist ||
    hasUSAlbumRelease
  );
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
 * Type for scored candidates (recordings or album tracks)
 */
type ScoredCandidate =
  | (NormalizedRecording & { score: number })
  | (AlbumTrackCandidate & { score: number });

/**
 * Generate canonical key for a work (title + primary artist)
 * Used to identify canonical works that must be included
 */
function canonicalKey(title: string, artist: string): string {
  const normalized = normalizeArtistName(artist);
  return `${normalizeTitleKey(title)}::${normalize(normalized.primary)}`;
}

/**
 * Generate song key for grouping (normalized title + normalized primary artist)
 * Used in songCollapse to group candidates by song
 */
function songKey(title: string, artist: string): string {
  const normalized = normalizeArtistName(artist);
  return `${normalizeTitleKey(title)}::${normalize(normalized.primary)}`;
}

/**
 * Normalize a title specifically for keying/grouping.
 *
 * This is slightly more opinionated than the general `normalize()`:
 * - Treats common contraction/shortcut variants as equivalent (e.g., "you've" ~ "u")
 *
 * Example:
 * - "Since You've Been Gone" -> "since you been gone"
 * - "Since U Been Gone"      -> "since you been gone"
 */
function normalizeTitleKey(title: string): string {
  const canonical = title.replace(/’/g, "'").toLowerCase();

  // Token-level canonicalization for common abbreviations / slang used in titles.
  // Keep this conservative (mostly 1:1 token swaps) to avoid exploding search space
  // or changing word counts in surprising ways.
  const tokenMap: Record<string, string> = {
    // you-forms
    u: "you",
    ya: "you",
    // love-forms
    luv: "love",
    // your-forms
    ur: "your",
    // conjunction shorthand
    n: "and",
  };

  const rawTokens = canonical.split(/\s+/).filter(Boolean);
  const tokens = rawTokens.map((t) => {
    // you've / youve -> you
    const youve = t.replace(/\byou'?ve\b/g, "you");
    return tokenMap[youve] ?? youve;
  });

  // Collapse duplicate adjacent tokens (e.g. "u you" -> "you", "you you" -> "you")
  const collapsed: string[] = [];
  for (const tok of tokens) {
    const prev = collapsed[collapsed.length - 1];
    if (prev && prev === tok) continue;
    collapsed.push(tok);
  }

  return normalize(collapsed.join(" "));
}

/**
 * Generate a small set of alternate title spellings for discovery.
 * Used to catch cases like "Since You've Been Gone" vs "Since U Been Gone".
 */
function titleVariants(title: string): string[] {
  const variants = new Set<string>();
  variants.add(title);

  const asciiApos = title.replace(/’/g, "'");
  variants.add(asciiApos);

  function collapseAdjacentDuplicates(s: string): string {
    const toks = s.split(/\s+/).filter(Boolean);
    const out: string[] = [];
    for (const tok of toks) {
      const prev = out[out.length - 1];
      if (prev && prev.toLowerCase() === tok.toLowerCase()) continue;
      out.push(tok);
    }
    return out.join(" ");
  }

  function applyTokenMap(s: string, map: Record<string, string>): string {
    const toks = s.split(/\s+/).filter(Boolean);
    const mapped = toks.map((tok) => {
      const lower = tok.toLowerCase();
      // Normalize apostrophes inside token for matching
      const normalized = lower.replace(/’/g, "'");
      return (
        map[normalized] ?? map[normalized.replace(/\byou'?ve\b/g, "you")] ?? tok
      );
    });
    return collapseAdjacentDuplicates(mapped.join(" "));
  }

  // Prefer "u"/"luv"/"ur"/"n" (helps match canonical stylized titles)
  const slangifyMap: Record<string, string> = {
    "you've": "u",
    youve: "u",
    you: "u",
    ya: "u",
    love: "luv",
    your: "ur",
    and: "n",
  };
  // Prefer "you"/"love"/"your"/"and" (helps match spelled-out titles)
  const canonicalizeMap: Record<string, string> = {
    u: "you",
    ya: "you",
    "you've": "you",
    youve: "you",
    luv: "love",
    ur: "your",
    n: "and",
  };

  const slangForm = applyTokenMap(asciiApos, slangifyMap);
  const canonicalForm = applyTokenMap(asciiApos, canonicalizeMap);
  variants.add(slangForm);
  variants.add(canonicalForm);

  return Array.from(variants).filter(Boolean);
}

/**
 * Collapse multiple candidates for the same song into a single representative
 *
 * Groups all candidates by songKey (normalizedTitle + "::" + normalizedPrimaryArtist)
 * For each group, selects exactly one representative:
 * - Prefer entityType === "recording" (only if recording was found in current search)
 * - Else allow entityType === "album_track"
 * - Discard all other candidates
 *
 * @param results - Array of canonical results to collapse
 * @param recordingsFound - Set of songKeys for recordings found in current search (prevents test isolation issues)
 * @returns Array with one result per songKey
 */
function songCollapse(
  results: CanonicalResult[],
  recordingsFound?: Set<string>,
): CanonicalResult[] {
  const groups = new Map<string, CanonicalResult[]>();

  // Group by songKey
  for (const result of results) {
    const key = songKey(result.title, result.artist);
    const group = groups.get(key) || [];
    group.push(result);
    groups.set(key, group);
  }

  // Select one representative per group
  const collapsed: CanonicalResult[] = [];
  for (const [key, group] of groups.entries()) {
    // Prefer recording, else album_track
    let representative: CanonicalResult | null = null;

    // First, try to find a recording (must be explicitly marked as recording)
    // Only prefer recording if it was found in the current search (not from previous tests)
    const recordings = group.filter((r) => r.entityType === "recording");
    // Only use recording if recordingsFound is provided AND contains this key
    // This ensures we don't prefer recordings from previous test runs
    const shouldUseRecording =
      recordings.length > 0 && recordingsFound && recordingsFound.has(key);

    if (shouldUseRecording) {
      // If multiple recordings, prefer highest score
      recordings.sort((a, b) => b.confidenceScore - a.confidenceScore);
      representative = recordings[0];
    } else {
      // If no recording (or recording not found in current search), use album_track
      const albumTracks = group.filter((r) => r.entityType === "album_track");
      if (albumTracks.length > 0) {
        // If multiple album tracks, prefer highest score
        albumTracks.sort((a, b) => b.confidenceScore - a.confidenceScore);
        representative = albumTracks[0];
      }
    }

    // If we found a representative, add it
    if (representative) {
      collapsed.push(representative);
    }
  }

  return collapsed;
}

/**
 * Identify canonical works that must be preserved when slicing results
 *
 * This function identifies canonical works (title + primary artist) that must be preserved.
 * A canonical work is identified by:
 * 1. Artist is globally prominent (via popularity index) AND exact title match
 * 2. Artist-scoped recording search produced an exact title match
 * 3. album_track with releaseTitle === title (single)
 * 4. release year ≥ 2000 AND artist has Wikipedia page AND exact title match
 *
 * Key change: This is work-based, not artist-based. One artist can appear multiple times
 * if they have multiple canonical works. One canonical work must appear at least once.
 *
 * Returns a Set of canonical work keys (title::primaryArtist)
 */
async function identifyMustIncludeCandidates(
  candidates: ScoredCandidate[],
  title: string,
  popularArtists: string[],
  debugInfo?: {
    stages: Record<string, unknown>;
  } | null,
): Promise<Set<string>> {
  const normalizedTitle = normalizeTitleKey(title);
  const canonicalWorks = new Set<string>();
  const artistWikipediaCache = new Map<string, Promise<boolean>>();

  // Normalize popular artists to primary names for comparison
  const normalizedPopularArtists = popularArtists.map((a) =>
    normalizeArtistName(a).primary.toLowerCase(),
  );

  for (const candidate of candidates) {
    // Check if it's a recording or album track
    const isAlbumTrack = "releaseId" in candidate;
    const candidateTitle = normalizeTitleKey(candidate.title);
    const titleMatches = candidateTitle === normalizedTitle;

    if (!titleMatches) continue;

    const candidateArtist = candidate.artist;
    const normalizedArtist = normalizeArtistName(candidateArtist);
    const primaryArtist = normalizedArtist.primary.toLowerCase();
    const workKey = canonicalKey(candidateTitle, candidateArtist);

    let shouldInclude = false;

    // Criterion 1: Artist is globally prominent (check primary artist)
    if (normalizedPopularArtists.includes(primaryArtist)) {
      shouldInclude = true;
    }

    // Criterion 2: Artist-scoped recording search produced an exact title match
    if (
      !isAlbumTrack &&
      (candidate as NormalizedRecording & { fromArtistScopedSearch?: boolean })
        .fromArtistScopedSearch === true
    ) {
      shouldInclude = true;
    }

    // Criterion 3: album_track with releaseTitle === title (single)
    if (
      isAlbumTrack &&
      candidate.releaseTitle &&
      normalizeTitleKey(candidate.releaseTitle) === normalizedTitle
    ) {
      shouldInclude = true;
    }

    // Criterion 4: release year ≥ 2000 AND artist has Wikipedia page
    if (!shouldInclude) {
      let year: number | null = null;
      let artistName: string | null = null;

      if ("releases" in candidate) {
        // Recording: check release years
        const recording = candidate as NormalizedRecording & { score: number };
        const years = recording.releases
          .map((r) => (r.year ? parseInt(r.year) : null))
          .filter((y): y is number => y !== null && !isNaN(y));
        if (years.length > 0) {
          year = Math.min(...years);
          artistName = recording.artist;
        }
      } else if (isAlbumTrack) {
        // Album track: check year property
        const albumTrack = candidate as AlbumTrackCandidate & { score: number };
        if (albumTrack.year) {
          const parsedYear = parseInt(albumTrack.year);
          if (!isNaN(parsedYear)) {
            year = parsedYear;
            artistName = albumTrack.artist;
          }
        }
      }

      if (year !== null && year >= 2000 && artistName) {
        // Check Wikipedia presence for primary artist (with caching)
        const primaryArtistKey = normalizeArtistName(artistName).primary;
        let hasWikipedia: boolean;
        if (artistWikipediaCache.has(primaryArtistKey)) {
          hasWikipedia = await artistWikipediaCache.get(primaryArtistKey)!;
        } else {
          const wikiPromise = checkWikipediaPresence(primaryArtistKey);
          artistWikipediaCache.set(primaryArtistKey, wikiPromise);
          hasWikipedia = await wikiPromise;
        }

        if (hasWikipedia) {
          shouldInclude = true;
        }
      }
    }

    if (shouldInclude) {
      canonicalWorks.add(workKey);
    }
  }

  // Debug logging for must-include identification
  if (debugInfo) {
    (debugInfo.stages as Record<string, unknown>).mustIncludeIdentification = {
      candidatesChecked: candidates.length,
      canonicalWorksFound: canonicalWorks.size,
      canonicalWorks: Array.from(canonicalWorks),
    };
  }

  return canonicalWorks;
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
  // Preserve entity type if already set correctly (e.g., album_track)
  // Only change if entity type is not explicitly set or is ambiguous
  if (
    result.entityType === "album_track" ||
    result.entityType === "song_inferred"
  ) {
    return result; // Preserve existing entity type
  }

  // MusicBrainz results are recordings (if not already album_track)
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
  const artistProvided = Boolean(artist);

  const debugInfo: DebugInfo | null = debug
    ? {
        stages: {},
        candidates: {},
      }
    : null;

  if (debugInfo) debugInfo.stages.parsed = { title, artist };

  let recordings: NormalizedRecording[] = [];
  let rawRecordings: MusicBrainzRecording[] = [];
  let albumTrackCandidates: AlbumTrackCandidate[] = [];

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
      // Multi-word queries - search recordings first, then discover album tracks
      // Album tracks are first-class candidates for modern pop songs
      // Also try a small set of title variants (e.g., "you've" -> "u")
      const variants = titleVariants(title);
      const variantRecordings = await Promise.all(
        // Keep this modest; we supplement recall via artist-scoped discovery below.
        variants.map((t) => searchByTitle(t, 75)),
      );
      const dedupRaw = new Map<string, MusicBrainzRecording>();
      for (const list of variantRecordings) {
        for (const rec of list) {
          if (rec?.id) dedupRaw.set(rec.id, rec);
        }
      }
      rawRecordings = Array.from(dedupRaw.values());
      recordings = normalizeRecordings(rawRecordings);

      // Derive candidate artists from recording search results
      // Extract unique artists from top recordings
      const artistFrequency = new Map<string, number>();
      for (const rec of recordings.slice(0, 50)) {
        // Limit to top 50 to avoid processing too many
        const artist = rec.artist;
        if (artist) {
          artistFrequency.set(artist, (artistFrequency.get(artist) || 0) + 1);
        }
      }

      // Also check raw recordings for additional artists
      for (const rec of rawRecordings.slice(0, 50)) {
        const artistCredit = rec["artist-credit"] ?? [];
        if (Array.isArray(artistCredit) && artistCredit.length > 0) {
          const firstEntry = artistCredit[0];
          const artistName =
            (typeof firstEntry === "object" && firstEntry?.name) ||
            (typeof firstEntry === "object" && firstEntry?.artist?.name) ||
            (typeof firstEntry === "string" ? firstEntry : null);
          if (artistName) {
            artistFrequency.set(
              artistName,
              (artistFrequency.get(artistName) || 0) + 1,
            );
          }
        }
      }

      // Sort by frequency and take top artists
      const candidateArtists = Array.from(artistFrequency.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([artist]) => artist);

      // Discover album tracks by scanning release tracks
      const discoveredAlbumTracks = await discoverAlbumTracks({
        title,
        candidateArtists,
        debugInfo,
      });

      albumTrackCandidates = discoveredAlbumTracks;

      // Discover artist-scoped recordings for popular artists
      // This fills the discovery gap for modern pop hits that don't appear in title-only searches
      const popularArtists = await getPopularArtists(20, candidateArtists);
      const artistScopedRecordings = await discoverArtistScopedRecordings({
        title,
        popularArtists,
        debugInfo,
      });

      // Merge artist-scoped recordings into recordings (deduplicate by ID)
      const existingIds = new Set(recordings.map((r) => r.id));
      for (const rec of artistScopedRecordings) {
        if (!existingIds.has(rec.id)) {
          recordings.push(rec);
          existingIds.add(rec.id);
        }
      }

      // Store popular artists for must-include identification later
      if (debugInfo) {
        if (!debugInfo.stages) {
          debugInfo.stages = {};
        }
        (debugInfo.stages as Record<string, unknown>).popularArtistsList =
          popularArtists;
      }

      // Note: we intentionally do not merge artist-scoped recordings back into
      // rawRecordings; the pipeline continues using normalized `recordings`.

      const searchTime = performance.now() - searchStartTime;
      if (debugInfo) {
        debugInfo.stages.recordings = recordings;
        debugInfo.stages.albumTracks = {
          found: discoveredAlbumTracks.length,
          discovered: true,
          candidateArtists: candidateArtists.length,
        };
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

  // Album track discovery now runs in parallel with recording search for multi-word queries
  // (handled above in the search section)
  // Keep album tracks as a separate entity type - do NOT merge with recordings

  // Keep recordings and album tracks separate - do NOT merge
  // Recordings will go through filtering and scoring
  // Album tracks will be scored separately and included in ambiguous results only

  // Step 3: Apply strict filters
  // BUT: Preserve must-include candidates even if they fail filters
  // Must-include is a recall guarantee - we can't let filters eliminate culturally obvious songs
  const filterStartTime = performance.now();
  let filtered = applyFilters(recordings, title);

  // Identify must-include candidates BEFORE filtering removes them
  // These are culturally obvious songs that must survive
  const mustIncludeBeforeFilter = recordings.filter((rec) =>
    isMustIncludeCandidate(rec, { title, artist }),
  );

  // Add must-include candidates back if they were filtered out
  const filteredIds = new Set(filtered.map((r) => r.id));
  const preservedIds: string[] = [];
  for (const mustInclude of mustIncludeBeforeFilter) {
    if (!filteredIds.has(mustInclude.id)) {
      filtered.push(mustInclude);
      preservedIds.push(mustInclude.id);
    }
  }

  if (debugInfo && preservedIds.length > 0) {
    (debugInfo.stages as Record<string, unknown>).mustIncludePreserved = {
      count: preservedIds.length,
      ids: preservedIds,
    };
  }

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
    const queryWordCount = normalizeTitleKey(title)
      .split(/\s+/)
      .filter((w) => w.length > 0).length;
    const beforeWordCountFilter = filtered.length;

    // Preserve release-track fallback candidates
    // Track which recordings came from release-track fallback
    const releaseTrackFallbackArtists = new Set<string>();
    if (debugInfo?.stages.releaseTrackFallback) {
      // We can't easily track which specific recordings came from fallback,
      // but we can preserve artists from release-track fallback
      // (This is a small set, so we track them during fallback)
    }

    filtered = filtered.filter((rec) => {
      const recTitleWords = normalizeTitleKey(rec.title)
        .split(/\s+/)
        .filter((w) => w.length > 0);
      const wordCountMatch = recTitleWords.length === queryWordCount;

      // Preserve release-track fallback recordings even if word count doesn't match
      if (!wordCountMatch) {
        const recArtist = normalize(rec.artist);
        if (releaseTrackFallbackArtists.has(recArtist)) {
          return true; // Preserve release-track fallback recordings
        }

        // Preserve must-include candidates (prominent artists, US album releases)
        // Check if this would qualify as must-include
        const recTitle = normalize(rec.title);
        const qTitle = normalize(title);
        if (recTitle === qTitle) {
          // Exact title match - check for must-include signals
          const hasUSAlbum = rec.releases.some(
            (r) =>
              r.primaryType?.toLowerCase() === "album" &&
              r.country?.toUpperCase() === "US",
          );
          // Preserve if it has US album release (strong canonical signal)
          if (hasUSAlbum) {
            return true;
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

  // Step 5: Assemble results with must-include guarantee
  // Separate inclusion from ranking - must-include candidates are guaranteed
  const MAX_RESULTS = 5;

  // Get popular artists list for must-include identification
  const popularArtistsList =
    (debugInfo?.stages.popularArtistsList as string[]) || [];

  // Identify must-include candidates BEFORE slicing.
  //
  // IMPORTANT: For title-only single-word queries, "must-include" is too permissive
  // (many artists have Wikipedia pages and many recordings match exactly), which can
  // crowd out the culturally obvious result. For those queries we rely on scoring
  // (exact-match + prominence) rather than hard-protecting works.
  let canonicalWorks = new Set<string>();
  if (!artistProvided && isSingleWordQuery) {
    if (debugInfo) {
      (debugInfo.stages as Record<string, unknown>).mustIncludeIdentification =
        {
          skipped: true,
          reason:
            "Skipped for title-only single-word queries to avoid over-protecting many exact matches",
        };
    }
  } else {
    // Combine scored recordings and album tracks for identification
    // Filter out recordings with null scores and ensure score is a number
    const allScoredCandidates: ScoredCandidate[] = [
      ...scored
        .filter((r) => r.score !== null)
        .map((r) => ({ ...r, score: r.score! })), // Assert non-null after filter
      ...scoredAlbumTracks,
    ];

    canonicalWorks = await identifyMustIncludeCandidates(
      allScoredCandidates,
      title,
      popularArtistsList,
      debugInfo,
    );
  }

  // Convert scored recordings to CanonicalResult format
  const recordingResults = canonicalPick(scored, scored.length);

  // Convert scored album tracks to CanonicalResult format
  const albumTrackResults: CanonicalResult[] = scoredAlbumTracks.map((at) => ({
    id: `album-track-${at.releaseId}`,
    title: at.title,
    artist: at.artist,
    year: at.year,
    releaseTitle: at.releaseTitle,
    entityType: "album_track" as CanonicalResult["entityType"],
    confidenceScore: at.score,
    source: (at.source || "musicbrainz") as CanonicalResult["source"],
    explanation: "Identified via album context",
  }));

  // Track recordings from artist-scoped search to prefer them over album tracks
  const artistScopedRecordings = new Set<string>();
  for (const rec of scored) {
    if (
      (rec as NormalizedRecording & { fromArtistScopedSearch?: boolean })
        .fromArtistScopedSearch === true
    ) {
      const key = canonicalKey(rec.title, rec.artist);
      artistScopedRecordings.add(key);
    }
  }

  // Track which canonical works are satisfied by recordings vs album tracks
  const canonicalWorksSatisfied = new Set<string>();

  // Track recordings that were actually found in this search (for entity-aware handling and songCollapse)
  // Use songKey to match what songCollapse uses
  const recordingsFound = new Set<string>();
  for (const result of recordingResults) {
    if (result.entityType === "recording") {
      const key = songKey(result.title, result.artist);
      recordingsFound.add(key);
    }
  }

  // Process recordings first - they take precedence
  const allResults: CanonicalResult[] = [];
  const seenIds = new Set<string>();

  for (const result of recordingResults) {
    if (seenIds.has(result.id)) continue;
    seenIds.add(result.id);

    const workKey = canonicalKey(result.title, result.artist);

    // If this satisfies a canonical work, mark it
    // Only mark as satisfied if it's actually a recording (not an album track)
    if (canonicalWorks.has(workKey) && result.entityType === "recording") {
      canonicalWorksSatisfied.add(workKey);
    }

    allResults.push(result);
  }

  // Process album tracks - add if they satisfy canonical works not yet satisfied
  // OR if no recording exists for that canonical work
  for (const result of albumTrackResults) {
    if (seenIds.has(result.id)) continue;

    const workKey = canonicalKey(result.title, result.artist);

    // Check if there's already a recording for this canonical work in the current results
    // Only skip if there's an actual recording that was found in this search
    if (recordingsFound.has(workKey)) {
      continue;
    }

    // Skip if there's a recording from artist-scoped search for the same canonical work
    if (artistScopedRecordings.has(workKey)) {
      continue;
    }

    // If this album track satisfies a canonical work, mark it
    if (canonicalWorks.has(workKey)) {
      canonicalWorksSatisfied.add(workKey);
    }

    seenIds.add(result.id);
    allResults.push(result);
  }

  // Separate protected (canonical works) and unprotected candidates
  const protectedResults: CanonicalResult[] = [];
  const unprotectedResults: CanonicalResult[] = [];

  for (const result of allResults) {
    const workKey = canonicalKey(result.title, result.artist);

    // Entity-aware handling: prefer recording over album_track ONLY if both exist for the SAME canonical work
    // If no recording exists for this canonical work, the album track must be used
    let finalResult = result;
    if (result.entityType === "album_track" && canonicalWorks.has(workKey)) {
      // Only replace with recording if a recording was actually found in this search
      // This prevents test isolation issues where recordings from previous tests might be found
      const songKeyForResult = songKey(result.title, result.artist);
      if (recordingsFound.has(songKeyForResult)) {
        const recordingResult = allResults.find(
          (r) =>
            r.entityType === "recording" &&
            r.id !== result.id &&
            canonicalKey(r.title, r.artist) === workKey,
        );
        if (recordingResult) {
          // Prefer recording over album track only if it was found in this search
          finalResult = recordingResult;
        }
      }
      // If no recording exists for this canonical work, keep the album track
    }

    // Check if this result satisfies a canonical work
    if (canonicalWorks.has(workKey)) {
      protectedResults.push(finalResult);
    } else {
      unprotectedResults.push(finalResult);
    }
  }

  // Sort unprotected by score (descending)
  unprotectedResults.sort((a, b) => b.confidenceScore - a.confidenceScore);

  // Build final results: protected first, then fill remaining slots with unprotected
  const finalResults: CanonicalResult[] = [];
  const remainingSlots = Math.max(0, MAX_RESULTS - protectedResults.length);

  // Add all protected results (must-include candidates cannot be evicted)
  finalResults.push(...protectedResults);

  // Fill remaining slots with highest-scoring unprotected candidates
  finalResults.push(...unprotectedResults.slice(0, remainingSlots));

  // Sort final results: canonical works first, then by score
  // Canonical works are already at the front, but ensure proper ordering
  finalResults.sort((a, b) => {
    const aKey = canonicalKey(a.title, a.artist);
    const bKey = canonicalKey(b.title, b.artist);
    const aIsCanonical = canonicalWorks.has(aKey);
    const bIsCanonical = canonicalWorks.has(bKey);

    // Canonical works come first
    if (aIsCanonical && !bIsCanonical) return -1;
    if (!aIsCanonical && bIsCanonical) return 1;

    // Within same category, sort by score
    return b.confidenceScore - a.confidenceScore;
  });

  // Track evicted candidates for debug logging
  const evictedCandidates = unprotectedResults.slice(remainingSlots);

  // Step: Collapse multiple candidates for the same song into a single representative
  // This ensures we return one result per song (grouped by normalized title + primary artist)
  // Pass recordingsFound to prevent preferring recordings from previous test runs
  const collapsedResults = songCollapse(finalResults, recordingsFound);

  let results = collapsedResults;
  if (debugInfo) {
    debugInfo.stages.results = results;
    debugInfo.stages.songCollapse = {
      before: finalResults.length,
      after: collapsedResults.length,
      collapsed: finalResults.length - collapsedResults.length,
    };
    debugInfo.stages.mustIncludeEnforcement = {
      protectedCount: protectedResults.length,
      canonicalWorks: Array.from(canonicalWorks),
      canonicalWorksSatisfied: Array.from(canonicalWorksSatisfied),
      evictedCandidates: evictedCandidates.map((r) => ({
        id: r.id,
        artist: r.artist,
        title: r.title,
        score: r.confidenceScore,
      })),
    };
  }
  if (results.length === 0) {
    if (debug && debugInfo) {
      return { response: null, debugInfo };
    }
    return null;
  }

  // Step 5.5: Late-stage Wikipedia fallback
  // Only when: MusicBrainz returns results, none match canonical artists, no explicit artist query
  // AND query looks like a song title (not live/remix/version)
  const topResult = results[0];
  const confidence = topResult.confidenceScore;

  const allowWikipediaInference =
    !artistProvided &&
    results.length > 0 &&
    confidence < 95 &&
    queryLooksLikeSongTitle(title);

  if (allowWikipediaInference) {
    // Check if results have strong signals (diverse releases, title tracks, etc.)
    // Wikipedia inference is only needed if results are weak AND no album tracks exist
    // Strong signals include: title tracks, multiple release types, older releases
    const hasStrongSignals = results.some((result) => {
      // Title track is a strong signal
      if (
        result.releaseTitle &&
        normalize(result.title) === normalize(result.releaseTitle)
      ) {
        return true;
      }
      // Older releases (pre-2000) are more likely canonical
      if (result.year && parseInt(result.year) < 2000) {
        return true;
      }
      return false;
    });

    // Only try Wikipedia inference if:
    // - No strong signals found in recordings
    // - No album tracks were found (album tracks handle canonical songs)
    // This prevents redundant Wikipedia lookups when album tracks already provide the answer
    if (!hasStrongSignals && albumTrackCandidates.length === 0) {
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
  // Never force canonical for title-only queries unless exactly one canonical work exists
  // Prominence is a seatbelt - guarantees inclusion but never forces canonical alone
  // Canonical mode only allowed when:
  //   - Artist explicitly provided, OR
  //   - Exactly one canonical work exists (culturally unambiguous)
  // If multiple canonical works exist, force ambiguous mode
  const totalCanonicalWorksCount = canonicalWorks.size;
  const hasMultipleCanonicalWorks = totalCanonicalWorksCount >= 2;

  // Never return canonical for title-only queries (multi-word or single-word)
  // Title-only queries are inherently ambiguous - require explicit artist for canonical
  let shouldReturnCanonical =
    artistProvided &&
    (totalCanonicalWorksCount === 1 || results.length === 1) &&
    !hasMultipleCanonicalWorks; // Multiple canonical works = ambiguous

  if (shouldReturnCanonical) {
    // Single canonical result
    // Do NOT include album tracks in canonical mode - filter to recordings only
    // For title-only queries, canonical mode should only return recordings
    const canonicalResults = results.filter(
      (r) => r.entityType === "recording",
    );
    if (canonicalResults.length === 0) {
      // No recordings available - fall back to ambiguous
      shouldReturnCanonical = false;
    } else {
      results = canonicalResults;
    }

    if (shouldReturnCanonical && debugInfo) {
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
    // Ambiguous query - return top results
    // This branch handles:
    // - Multi-word title-only queries (always ambiguous, album tracks already merged above)
    // - Single-word queries with close scores (score gap < CANONICAL_SCORE_GAP)
    const maxResults = !artistProvided && !isSingleWordQuery ? 10 : 5;
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

      const albumTracksIncluded =
        !artistProvided && !isSingleWordQuery
          ? (debugInfo.stages.albumTracksIncluded as number) || 0
          : 0;

      const recordingsIncluded = Math.min(
        results.filter((r) => r.entityType === "recording").length,
        maxResults - albumTracksIncluded,
      );

      debugInfo.stages.finalSelection = {
        maxResults,
        recordingsIncluded,
        albumTracksIncluded,
        albumTracksTotal: scoredAlbumTracks.length,
        reason:
          albumTracksIncluded > 0
            ? `Included ${albumTracksIncluded} album track(s) in ambiguous results`
            : reason,
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
