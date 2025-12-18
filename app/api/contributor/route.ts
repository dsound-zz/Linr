import { NextRequest, NextResponse } from "next/server";
import { performance } from "node:perf_hooks";
import type { ContributorProfile } from "@/lib/types";
import { getMBClient, lookupRecording, lookupArtist, lookupArtistWithRecordings } from "@/lib/musicbrainz";
import type { MusicBrainzRecording } from "@/lib/types";
import { verifyContributor, filterRecordings, enrichWithKnownWorks } from "@/lib/ai-contributor";

const MAX_CONTRIBUTOR_RECORDINGS = 400;
const CONTRIBUTOR_PAGE_SIZE = 100;
const WORK_PAGE_SIZE = 50;
const MAX_FIRST_PAGE_LOOKUPS = 4;

// Optional: Enable work-based queries (can be disabled for performance)
const ENABLE_WORK_QUERIES = process.env.ENABLE_WORK_QUERIES !== 'false';

// Performance tracking
interface PerformanceMetrics {
  totalDuration: number;
  artistSearchMs: number;
  artistLookupMs: number;
  recordingSearchMs: number;
  recordingLookupsMs: number;
  workSearchMs: number;
  queryCounts: {
    artistSearch: number;
    artistLookup: number;
    recordingSearch: number;
    recordingLookups: number;
    workSearch: number;
  };
  resultCounts: {
    totalRecordings: number;
    fromRecordingSearch: number;
    fromWorkSearch: number;
    aliases: number;
  };
}

type QueryPlan = {
  query: string;
  offset: number;
  done: boolean;
};

interface ContributorCache {
  artistId: string;
  aliasKeys: Set<string>;
  aliasNames: Set<string>;
  queryPlan: QueryPlan[];
  querySet: Set<string>;
  recordings: MusicBrainzRecording[];
  recordingIds: Set<string>;
  processing?: Promise<void>;
  backgroundPromise?: Promise<void>;
  completed: boolean;
  workQueryPlan: QueryPlan[];
  workQuerySet: Set<string>;
  workIds: Set<string>;
}

const contributorCache = new Map<string, ContributorCache>();

// Cache for recording lookups (shared across all contributors)
const RECORDING_CACHE_MAX_SIZE = 1000;
const RECORDING_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

interface CachedRecording {
  recording: MusicBrainzRecording;
  timestamp: number;
}

const recordingCache = new Map<string, CachedRecording>();

// Timeout wrapper to prevent hanging on slow MusicBrainz requests
function logStep(
  step: string,
  startTime: number,
  details: Record<string, unknown>,
) {
  const durationMs = performance.now() - startTime;
  const payload = {
    step,
    durationMs: Number(durationMs.toFixed(2)),
    ...details,
  };
  console.log("[Contributor API][perf]", payload);
  return durationMs;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | null> {
  const timeout = new Promise<null>((resolve) =>
    setTimeout(() => resolve(null), timeoutMs)
  );
  return Promise.race([promise, timeout]);
}

async function lookupRecordingCached(id: string): Promise<MusicBrainzRecording | null> {
  const cacheReadStart = performance.now();
  const cached = recordingCache.get(id);
  if (cached && Date.now() - cached.timestamp < RECORDING_CACHE_TTL_MS) {
    logStep("recording-cache-read", cacheReadStart, {
      recordingId: id,
      hit: true,
    });
    return cached.recording;
  }
  logStep("recording-cache-read", cacheReadStart, {
    recordingId: id,
    hit: false,
  });

  try {
    // Add 10 second timeout to prevent hanging on slow requests
    const lookupStart = performance.now();
    const recording = await withTimeout(lookupRecording(id), 10000);
    logStep("lookupRecording", lookupStart, {
      recordingId: id,
      succeeded: Boolean(recording),
    });
    if (recording) {
      // Simple LRU: if cache is full, remove oldest entries
      if (recordingCache.size >= RECORDING_CACHE_MAX_SIZE) {
        const oldestKey = recordingCache.keys().next().value;
        if (oldestKey) recordingCache.delete(oldestKey);
      }
      recordingCache.set(id, { recording, timestamp: Date.now() });
      logStep("recording-cache-write", performance.now(), {
        recordingId: id,
        cacheSize: recordingCache.size,
      });
    }
    return recording;
  } catch {
    return null;
  }
}

const escapeQueryValue = (value: string) => value.replace(/"/g, '\\"');

// Optimized: reduced from 3 to 2 query templates
// artistname and creditname often return similar results
const queryTemplates = [
  (value: string) => `artist:"${escapeQueryValue(value)}"`,
  (value: string) => `creditname:"${escapeQueryValue(value)}"`,
];

function addAliasQueries(state: ContributorCache, alias: string) {
  for (const template of queryTemplates) {
    const query = template(alias);
    if (state.querySet.has(query)) continue;
    state.querySet.add(query);
    state.queryPlan.push({ query, offset: 0, done: false });
  }
}

function ensureStateHasAlias(state: ContributorCache, alias?: string) {
  if (typeof alias !== "string") return;
  const trimmed = alias.trim();
  if (trimmed.length === 0) return;
  const normalized = trimmed.toLowerCase();
  if (!state.aliasKeys.has(normalized)) {
    state.aliasKeys.add(normalized);
  }
  if (state.aliasNames.has(trimmed)) return;
  state.aliasNames.add(trimmed);
  addAliasQueries(state, trimmed);
  state.completed = false;
}

function buildContributorCache(
  artistId: string,
  initialAliases: string[],
): ContributorCache {
  const state: ContributorCache = {
    artistId,
    aliasKeys: new Set<string>(),
    aliasNames: new Set<string>(),
    queryPlan: [{ query: `arid:${artistId}`, offset: 0, done: false }],
    querySet: new Set<string>([`arid:${artistId}`]),
    recordings: [],
    recordingIds: new Set<string>(),
    completed: false,
    workQueryPlan: [{ query: `arid:${artistId}`, offset: 0, done: false }],
    workQuerySet: new Set<string>([`arid:${artistId}`]),
    workIds: new Set<string>(),
  };

  initialAliases.forEach((alias) => ensureStateHasAlias(state, alias));
  return state;
}

function addRecordingToState(state: ContributorCache, rec: MusicBrainzRecording) {
  const id = rec.id || rec["id"] || rec.mbid;
  if (
    typeof id !== "string" ||
    state.recordingIds.has(id) ||
    state.recordings.length >= MAX_CONTRIBUTOR_RECORDINGS
  ) {
    return;
  }
  state.recordingIds.add(id);
  state.recordings.push(rec);
  if (state.recordings.length >= MAX_CONTRIBUTOR_RECORDINGS) {
    state.completed = true;
  }
}

function addWorkRecordingQuery(state: ContributorCache, workId: string) {
  const query = `workid:${workId}`;
  if (state.querySet.has(query)) return;
  state.querySet.add(query);
  state.queryPlan.push({ query, offset: 0, done: false });
  state.completed = false;
}

async function addRecordingsFromRelationships(
  state: ContributorCache,
  artistId: string,
): Promise<number> {
  try {
    const artistWithRels = await lookupArtistWithRecordings(artistId);
    const relations = (artistWithRels as any).relations ?? [];

    let addedCount = 0;
    for (const rel of relations) {
      // Only process recording relationships
      if (rel["target-type"] !== "recording") continue;
      if (!rel.recording) continue;

      // Add the recording to state
      const recording = rel.recording as MusicBrainzRecording;
      const id = recording.id || recording["id"];
      if (id && !state.recordingIds.has(id)) {
        addRecordingToState(state, recording);
        addedCount++;
      }

      if (state.recordings.length >= MAX_CONTRIBUTOR_RECORDINGS) {
        break;
      }
    }

    return addedCount;
  } catch (error) {
    console.error("Failed to fetch recording relationships:", error);
    return 0;
  }
}

async function processWorkQueryPlan(
  state: ContributorCache,
  neededCount: number,
  stopAfterNeeded: boolean,
  mb: ReturnType<typeof getMBClient>,
): Promise<void> {
  for (const plan of state.workQueryPlan) {
    if (plan.done) continue;

    while (!plan.done && state.recordings.length < MAX_CONTRIBUTOR_RECORDINGS) {
      const result = await mb.search("work", {
        query: plan.query,
        limit: WORK_PAGE_SIZE,
        offset: plan.offset,
      });

      const works = result.works ?? [];
      plan.offset += WORK_PAGE_SIZE;

      if (works.length < WORK_PAGE_SIZE) {
        plan.done = true;
      }

      for (const work of works) {
        if (!work?.id || state.workIds.has(work.id)) continue;
        state.workIds.add(work.id);
        addWorkRecordingQuery(state, work.id);
      }

      if (stopAfterNeeded && state.recordings.length >= neededCount) {
        return;
      }

      if (works.length === 0) {
        plan.done = true;
      }
    }
  }
}

async function processQueryPlan(
  state: ContributorCache,
  neededCount: number,
  stopAfterNeeded: boolean,
): Promise<void> {
  const mb = getMBClient();
  while (state.recordings.length < MAX_CONTRIBUTOR_RECORDINGS) {
    let plan = state.queryPlan.find((candidate) => !candidate.done);

    if (!plan) {
      // Only process work queries if enabled
      if (ENABLE_WORK_QUERIES) {
        await processWorkQueryPlan(state, neededCount, stopAfterNeeded, mb);
        plan = state.queryPlan.find((candidate) => !candidate.done);
        if (!plan) break;
        continue;
      } else {
        break;
      }
    }

    while (!plan.done && state.recordings.length < MAX_CONTRIBUTOR_RECORDINGS) {
      const result = await mb.search("recording", {
        query: plan.query,
        limit: CONTRIBUTOR_PAGE_SIZE,
        offset: plan.offset,
      });

      const rawRecordings = result.recordings ?? [];
      plan.offset += CONTRIBUTOR_PAGE_SIZE;

      if (rawRecordings.length < CONTRIBUTOR_PAGE_SIZE) {
        plan.done = true;
      }

      for (const rec of rawRecordings) {
        addRecordingToState(state, rec as MusicBrainzRecording);
      }

      if (stopAfterNeeded && state.recordings.length >= neededCount) {
        return;
      }

      if (rawRecordings.length === 0) {
        plan.done = true;
      }

      if (state.recordings.length >= MAX_CONTRIBUTOR_RECORDINGS) {
        state.completed = true;
        return;
      }
    }
  }

  if (
    state.queryPlan.every((candidate) => candidate.done) &&
    state.workQueryPlan.every((candidate) => candidate.done)
  ) {
    state.completed = true;
  }
}

function startBackgroundFetch(state: ContributorCache) {
  if (state.completed || state.backgroundPromise) return;
  state.backgroundPromise = processQueryPlan(state, Infinity, false).finally(() => {
    state.backgroundPromise = undefined;
  });
}

async function ensureMinimumRecordings(
  state: ContributorCache,
  neededCount: number,
): Promise<void> {
  if (state.completed || state.recordings.length >= neededCount) return;
  if (!state.processing) {
    state.processing = processQueryPlan(state, neededCount, true).finally(() => {
      state.processing = undefined;
      startBackgroundFetch(state);
    });
  }
  await state.processing;
}

/**
 * GET /api/contributor
 *
 * Aggregates all recordings where a person contributed.
 * Searches MusicBrainz for recordings with this person in artist-rels.
 *
 * Strategy:
 * 1. Fast search to get all recording IDs (up to 400)
 * 2. Do detailed lookups for current page only to get relationship data
 * 3. Return quickly with rich data for current page
 * 4. Background fetch continues to load more recordings
 *
 * Query params:
 *   - name: The contributor's name (required)
 *   - limit: Number of recordings to return (default 20, max 50)
 *   - offset: Offset for pagination (default 0)
 */
export async function GET(request: NextRequest) {
  const startTime = Date.now();
  const { searchParams } = new URL(request.url);
  const name = searchParams.get("name");
  const mbid = searchParams.get("mbid"); // Artist MBID for exact matching
  const limitParam = searchParams.get("limit");
  const offsetParam = searchParams.get("offset");
  const fromSong = searchParams.get("from_song"); // Originating song title for context
  const fromArtist = searchParams.get("from_artist"); // Originating song artist for context
  const fromRoles = searchParams.get("from_roles"); // Roles in originating song (comma-separated)
  const debug =
    searchParams.get("debug") === "1" || searchParams.get("debug") === "true";

  const limit = limitParam ? Math.min(parseInt(limitParam, 10), 50) : 20;
  const offset = offsetParam ? parseInt(offsetParam, 10) : 0;

  // Metrics tracking
  const metrics: PerformanceMetrics = {
    totalDuration: 0,
    artistSearchMs: 0,
    artistLookupMs: 0,
    recordingSearchMs: 0,
    recordingLookupsMs: 0,
    workSearchMs: 0,
    queryCounts: {
      artistSearch: 0,
      artistLookup: 0,
      recordingSearch: 0,
      recordingLookups: 0,
      workSearch: 0,
    },
    resultCounts: {
      totalRecordings: 0,
      fromRecordingSearch: 0,
      fromWorkSearch: 0,
      aliases: 0,
    },
  };

  if (!name || typeof name !== "string" || name.trim().length === 0) {
    return NextResponse.json(
      { error: "Missing or invalid 'name' parameter" },
      { status: 400 },
    );
  }

  try {
    const mb = getMBClient();

    let artistId: string;
    let topArtist: any;

    // If MBID is provided, use it directly (exact match from song credits)
    if (mbid && typeof mbid === "string" && mbid.trim().length > 0) {
      artistId = mbid.trim();

      // Fetch artist details for name and aliases
      const artistLookupStart = performance.now();
      try {
        topArtist = await lookupArtist(artistId);
        const duration = logStep("artist-lookup", artistLookupStart, {
          source: "direct-mbid",
          success: true,
        });
        metrics.artistLookupMs = duration;
        metrics.queryCounts.artistLookup = 1;
      } catch {
        // If lookup fails, continue with just the MBID
        const duration = logStep("artist-lookup", artistLookupStart, {
          source: "direct-mbid",
          success: false,
        });
        metrics.artistLookupMs = duration;
        topArtist = { id: artistId, name: name };
      }
    } else {
      // Fall back to search by name if no MBID provided
      const artistSearchStart = performance.now();
      const artistSearchResult = await mb.search("artist", {
        query: `artist:"${name.trim()}"`,
        limit: 5,
      });
      const searchDuration = logStep("artist-search", artistSearchStart, {
        results: artistSearchResult.artists?.length ?? 0,
      });
      metrics.artistSearchMs = searchDuration;
      metrics.queryCounts.artistSearch = 1;

      const artists = artistSearchResult.artists ?? [];
      if (artists.length === 0) {
        return NextResponse.json({
          name,
          totalContributions: 0,
          totalRecordings: 0,
          hasMore: false,
          roleBreakdown: [],
          contributions: [],
        } as ContributorProfile);
      }

      // Use the top matching artist
      topArtist = artists[0];
      artistId = topArtist.id;
      if (!artistId) {
        return NextResponse.json({
          name,
          totalContributions: 0,
          totalRecordings: 0,
          hasMore: false,
          roleBreakdown: [],
          contributions: [],
        } as ContributorProfile);
      }
    }

    const aliasExpansionStart = performance.now();
    const aliasCandidates = new Set<string>();
    const addAliasCandidate = (value?: string) => {
      if (typeof value !== "string") return;
      const trimmed = value.trim();
      if (trimmed.length === 0) return;
      aliasCandidates.add(trimmed);
    };

    // Start with minimal aliases: just the search name and artist name
    addAliasCandidate(name);
    if (topArtist.name) {
      addAliasCandidate(topArtist.name);
    }

    const cacheReadStart = performance.now();
    let state = contributorCache.get(artistId);
    logStep("cache-read", cacheReadStart, {
      cache: "contributor",
      artistId,
      hit: Boolean(state),
      aliasCount: state?.aliasNames.size ?? 0,
    });
    let aliasesExpanded = false;

    if (!state) {
      // For new contributors, always fetch full aliases to ensure completeness
      // This is especially important for prolific contributors like Max Martin
      const artistLookupStart = performance.now();
      try {
        const fullArtist = await lookupArtist(artistId);
        const duration = logStep("artist-lookup", artistLookupStart, {
          source: "alias-expansion",
          success: true,
        });
        metrics.artistLookupMs = duration;
        metrics.queryCounts.artistLookup = 1;

        if (fullArtist.name) {
          addAliasCandidate(fullArtist.name);
        }

        if (Array.isArray(fullArtist.aliases)) {
          for (const alias of fullArtist.aliases) {
            addAliasCandidate(alias.name);
          }
        }
      } catch {
        // If lookup fails, continue with minimal aliases
        const duration = logStep("artist-lookup", artistLookupStart, {
          source: "alias-expansion",
          success: false,
        });
        metrics.artistLookupMs = duration;
      }

      // Create state with all aliases
      state = buildContributorCache(artistId, Array.from(aliasCandidates));
      contributorCache.set(artistId, state);
      logStep("cache-write", performance.now(), {
        cache: "contributor",
        artistId,
        aliasCount: state.aliasNames.size,
      });
      metrics.resultCounts.aliases = aliasCandidates.size;
      aliasesExpanded = true;

      // Fetch recording relationships (for session musicians/contributors)
      const relStart = performance.now();
      const relCount = await addRecordingsFromRelationships(state, artistId);
      logStep("recording-rels", relStart, {
        recordingsAdded: relCount,
        totalRecordings: state.recordings.length,
      });
    } else {
      // Ensure current search name is in the state
      for (const alias of aliasCandidates) {
        ensureStateHasAlias(state, alias);
      }
    }
    logStep("alias-expansion", aliasExpansionStart, {
      aliasCandidates: aliasCandidates.size,
      stateAliases: state.aliasNames.size,
    });

    const neededCount = Math.min(
      Math.max(offset + limit, 0),
      MAX_CONTRIBUTOR_RECORDINGS,
    );

    const recordingSearchStart = performance.now();
    await ensureMinimumRecordings(state, neededCount);
    const discoveryDuration = logStep("recording-discovery", recordingSearchStart, {
      neededCount,
      totalFetched: state.recordings.length,
      completed: state.completed,
    });
    metrics.recordingSearchMs = discoveryDuration;

    if (state.recordings.length === 0) {
      metrics.totalDuration = Date.now() - startTime;
      console.log('[Contributor API] No recordings found', { name, metrics });
      return NextResponse.json({
        name,
        totalContributions: 0,
        totalRecordings: 0,
        hasMore: false,
        roleBreakdown: [],
        contributions: [],
      } as ContributorProfile);
    }

    const aliasKeys = state.aliasKeys;
    metrics.resultCounts.totalRecordings = state.recordings.length;

    // Step 3: For the requested page, do detailed lookups to get relationship data
    const totalRecordings = state.completed
      ? state.recordings.length
      : Math.max(state.recordings.length, neededCount);
    const paginationStart = performance.now();
    const pageRecordings = state.recordings.slice(offset, offset + limit);
    logStep("pagination", paginationStart, {
      offset,
      limit,
      pageCount: pageRecordings.length,
      totalRecordings,
    });

    // Do detailed lookups in parallel for this page using cache
    const lookupStart = performance.now();
    /**
     * PERF NOTE (2025-02-14):
     * Instrumentation for "larry carlton" showed the recording-lookups step dominating (~10s)
     * because firing 20 lookupRecording requests in parallel trips the MusicBrainz 1 req/sec limit.
     * The slowdowns were sequential (every extra request waited ~10s before timing out), repeated for
     * every offset=0 request, and unrelated to AI (not triggered). ensureMinimumRecordings stayed bounded.
     * To keep the first page < 8s we cap detailed lookups to a smaller batch on the first page and fall
     * back to lightweight search payloads for the remainder.
     */
    const detailedRecordings = await Promise.all(
      pageRecordings.map(async (rec, idx) => {
        if (!rec.id) return rec;
        const shouldLookup =
          offset > 0 || idx < Math.min(MAX_FIRST_PAGE_LOOKUPS, pageRecordings.length);
        if (!shouldLookup) {
          return rec;
        }
        metrics.queryCounts.recordingLookups++;
        const detailed = await lookupRecordingCached(rec.id);
        return detailed || rec; // Fallback to search result if lookup fails
      })
    );
    const lookupDuration = logStep("recording-lookups", lookupStart, {
      count:
        offset > 0
          ? pageRecordings.length
          : Math.min(MAX_FIRST_PAGE_LOOKUPS, pageRecordings.length),
    });
    metrics.recordingLookupsMs = lookupDuration;

    // AI-powered filtering and verification (if context provided)
    // OPTIMIZATION: Skip AI filtering on first page load (offset=0) to improve performance
    // AI filtering adds 5-10+ seconds, so only do it for subsequent pages or when explicitly requested
    let aiFilteredRecordings = detailedRecordings;
    let aiEnrichedWorks: Array<{ title: string; artist: string; confidence: number }> = [];
    let verification: Awaited<ReturnType<typeof verifyContributor>> = null;
    const enableAiFiltering = offset > 0; // Only filter for subsequent pages

    if (mbid && fromSong && fromArtist) {
      try {
        // Step 3a: Verify contributor identity with AI (quick, ~1-2 seconds)
        const aiVerifyStart = performance.now();
        verification = await verifyContributor({
          name,
          mbid,
          originatingSong: {
            title: fromSong,
            artist: fromArtist,
            roles: fromRoles ? fromRoles.split(',') : [],
          },
        });
        logStep("ai-verification", aiVerifyStart, {
          triggered: true,
        });

        if (verification && verification.isCorrectPerson && verification.confidence > 0.7) {
          console.log('[Contributor API] AI verified contributor:', {
            name,
            confidence: verification.confidence,
            knownFor: verification.knownFor?.slice(0, 3),
          });

          // Step 3b: Filter recordings with AI (slow, 5-10+ seconds)
          // OPTIMIZATION: Only filter if enabled (offset > 0)
          if (enableAiFiltering) {
            const aiFilterStart = performance.now();
            const recordingsForFiltering = detailedRecordings.map(r => {
              const firstCredit = r['artist-credit']?.[0];
              let artist = 'Unknown';
              if (typeof firstCredit === 'string') {
                artist = firstCredit;
              } else if (firstCredit) {
                artist = firstCredit.name ?? firstCredit.artist?.name ?? 'Unknown';
              }
              return {
                title: r.title ?? 'Unknown',
                artist,
                date: r.releases?.[0]?.date ?? r.date,
              };
            });

            const filterResults = await filterRecordings(
              { name, mbid, verification, originatingSong: { title: fromSong, artist: fromArtist, roles: fromRoles?.split(',') || [] } },
              recordingsForFiltering
            );

            // Keep only recordings AI says should be included with reasonable confidence
            aiFilteredRecordings = detailedRecordings.filter((_, idx) => {
              const filterResult = filterResults[idx];
              return filterResult && filterResult.shouldInclude && filterResult.confidence > 0.6;
            });

            logStep("ai-filtering", aiFilterStart, {
              enabled: true,
              originalCount: detailedRecordings.length,
              filteredCount: aiFilteredRecordings.length,
            });
            console.log('[Contributor API] AI filtered recordings:', {
              original: detailedRecordings.length,
              filtered: aiFilteredRecordings.length,
            });
          }

          // Step 3c: If MusicBrainz data is insufficient, enrich with AI-inferred works
          // Only enrich on first page load when we haven't filtered yet
          if (!enableAiFiltering && aiFilteredRecordings.length < 3) {
            const aiEnrichStart = performance.now();
            aiEnrichedWorks = await enrichWithKnownWorks({
              name,
              mbid,
              verification,
              originatingSong: {
                title: fromSong,
                artist: fromArtist,
                roles: fromRoles?.split(',') || [],
              },
            });
            logStep("ai-enrichment", aiEnrichStart, {
              enrichedCount: aiEnrichedWorks.length,
            });

            console.log('[Contributor API] AI enriched with known works:', {
              enrichedCount: aiEnrichedWorks.length,
              mbRecordings: aiFilteredRecordings.length,
            });
          }
        }
      } catch (err) {
        console.error('[Contributor API] AI filtering failed, using all recordings:', err);
        // Fall back to all recordings if AI fails
      }
    }

    // Build contributions list and aggregate roles
    // Use AI-filtered recordings if available, otherwise use all
    const recordingsToProcess = aiFilteredRecordings;
    const contributionsMap = new Map<
      string,
      {
        recordingId: string;
        title: string;
        artist: string;
        releaseDate: string | null;
        roles: Set<string>;
      }
    >();

    const roleCountMap = new Map<string, number>();

    for (const recording of recordingsToProcess) {
      const recordingId = recording.id;
      if (!recordingId) continue;

      const title = recording.title ?? "Unknown Title";

      // Extract artist name from artist-credit (handle both string and object types)
      const firstCredit = recording["artist-credit"]?.[0];
      let artist = "Unknown Artist";
      if (typeof firstCredit === "string") {
        artist = firstCredit;
      } else if (firstCredit) {
        artist = firstCredit.name ?? firstCredit.artist?.name ?? "Unknown Artist";
      }

      // Extract release date
      const releaseDate =
        recording.releases?.[0]?.date ??
        recording["first-release-date"] ??
        null;

      // Extract roles from artist-credit relationships
      const roles = new Set<string>();

      // Check artist-credit for the matching name or aliases
      const artistCredits = recording["artist-credit"] ?? [];
      for (const credit of artistCredits) {
        // Handle both string and object types in artist-credit
        let creditName: string | undefined;
        let creditArtistId: string | undefined;

        if (typeof credit === "string") {
          creditName = credit;
        } else {
          creditName = credit.name || credit.artist?.name;
          creditArtistId = credit.artist?.id;
        }

        // Match by ID or by name/aliases
        if (
          creditArtistId === artistId ||
          (creditName && aliasKeys.has(creditName.toLowerCase()))
        ) {
          roles.add("performer");
        }
      }

      // Extract from relations (if available)
      const relations = (recording as any).relations ?? [];
      for (const rel of relations) {
        const relType = rel.type?.toLowerCase() ?? "";
        const relArtist = rel.artist;

        // Check if this relation is for our contributor
        const relArtistName = relArtist?.name ?? "";
        const relArtistId = relArtist?.id ?? "";

        // Match by ID first, then by name/aliases
        const isMatch =
          relArtistId === artistId ||
          aliasKeys.has(relArtistName.toLowerCase());

        if (isMatch && relType) {
          // Get instrument/attribute if available for more specific role
          const attributes = rel.attributes ?? [];
          const attributeStr = attributes.join(", ");

          // Map MusicBrainz relation types to friendly role names
          if (relType.includes("producer")) {
            roles.add(attributeStr || "producer");
          } else if (relType.includes("composer") || relType.includes("writer")) {
            roles.add(attributeStr || "writer");
          } else if (relType.includes("engineer")) {
            if (relType.includes("mix")) {
              roles.add("mixing engineer");
            } else if (relType.includes("master")) {
              roles.add("mastering engineer");
            } else {
              roles.add(attributeStr || "recording engineer");
            }
          } else if (relType.includes("lyricist")) {
            roles.add("lyricist");
          } else if (relType.includes("vocal")) {
            roles.add(attributeStr || "vocals");
          } else if (relType.includes("instrument")) {
            // Use the attribute (instrument name) if available
            roles.add(attributeStr || "performer");
          } else if (relType) {
            roles.add(attributeStr || relType);
          }
        }
      }

      // If no specific role found, default to performer
      if (roles.size === 0) {
        roles.add("performer");
      }

      // Update role counts
      for (const role of roles) {
        roleCountMap.set(role, (roleCountMap.get(role) ?? 0) + 1);
      }

      // Add to contributions map (dedupe by recording ID)
      if (!contributionsMap.has(recordingId)) {
        contributionsMap.set(recordingId, {
          recordingId,
          title,
          artist,
          releaseDate,
          roles: new Set(),
        });
      }

      // Merge roles
      const existing = contributionsMap.get(recordingId)!;
      for (const role of roles) {
        existing.roles.add(role);
      }
    }

    // Add AI-enriched works if MusicBrainz data is insufficient
    if (aiEnrichedWorks.length > 0) {
      for (const work of aiEnrichedWorks) {
        // Create a synthetic ID for AI-inferred works
        const syntheticId = `ai-${work.title.toLowerCase().replace(/[^a-z0-9]/g, '-')}-${work.artist.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;

        if (!contributionsMap.has(syntheticId)) {
          // Infer roles from original context
          const inferredRoles = new Set<string>();
          if (fromRoles) {
            fromRoles.split(',').forEach(role => inferredRoles.add(role.trim()));
          } else {
            inferredRoles.add('producer'); // Default assumption based on Max Martin context
          }

          contributionsMap.set(syntheticId, {
            recordingId: syntheticId,
            title: work.title,
            artist: work.artist,
            releaseDate: null, // AI doesn't provide dates
            roles: inferredRoles,
          });

          // Update role counts
          for (const role of inferredRoles) {
            roleCountMap.set(role, (roleCountMap.get(role) ?? 0) + 1);
          }
        }
      }
    }

    // Convert to arrays and sort
    const contributions = Array.from(contributionsMap.values())
      .map((c) => ({
        ...c,
        roles: Array.from(c.roles).sort(),
      }))
      .sort((a, b) => {
        // Sort by release date descending (newest first)
        if (a.releaseDate && b.releaseDate) {
          return b.releaseDate.localeCompare(a.releaseDate);
        }
        if (a.releaseDate) return -1;
        if (b.releaseDate) return 1;
        return 0;
      });

    const roleBreakdown = Array.from(roleCountMap.entries())
      .map(([role, count]) => ({ role, count }))
      .sort((a, b) => b.count - a.count); // Sort by count descending

    const totalContributions = Array.from(contributionsMap.values()).reduce(
      (sum, c) => sum + c.roles.size,
      0,
    );

    // If we're showing AI-enriched works, don't offer pagination
    // (AI gives us a fixed set of ~10-15 known works, not hundreds to paginate through)
    const hasMore = aiEnrichedWorks.length > 0
      ? false // No pagination for AI-enriched results
      : (!state.completed || offset + limit < state.recordings.length);

    const profile: ContributorProfile = {
      name,
      totalContributions,
      totalRecordings: aiEnrichedWorks.length > 0
        ? contributionsMap.size // For AI results, show actual count of what we're displaying
        : totalRecordings, // For MusicBrainz results, show the total available
      hasMore,
      roleBreakdown,
      contributions,
    };

    // Final metrics
    metrics.totalDuration = Date.now() - startTime;

    // Log performance metrics
    console.log('[Contributor API] Request completed', {
      name,
      mbidProvided: !!mbid,
      artistId,
      offset,
      limit,
      cacheHit: contributorCache.has(artistId),
      aliasesExpanded,
      workQueriesEnabled: ENABLE_WORK_QUERIES,
      metrics,
    });

    // Always include perf metrics so callers can debug timeouts without query flags
    return NextResponse.json({ ...profile, metrics });
  } catch (err) {
    console.error("Contributor API error:", err);
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Failed to fetch contributor data",
      },
      { status: 500 },
    );
  }
}
