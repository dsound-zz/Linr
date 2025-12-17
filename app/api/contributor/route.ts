import { NextRequest, NextResponse } from "next/server";
import type { ContributorProfile } from "@/lib/types";
import { getMBClient, lookupRecording, lookupArtist } from "@/lib/musicbrainz";
import type { MusicBrainzRecording } from "@/lib/types";

const MAX_CONTRIBUTOR_RECORDINGS = 400;
const CONTRIBUTOR_PAGE_SIZE = 100;
const WORK_PAGE_SIZE = 50;

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

const escapeQueryValue = (value: string) => value.replace(/"/g, '\\"');

const queryTemplates = [
  (value: string) => `artist:"${escapeQueryValue(value)}"`,
  (value: string) => `artistname:"${escapeQueryValue(value)}"`,
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
      await processWorkQueryPlan(state, neededCount, stopAfterNeeded, mb);
      plan = state.queryPlan.find((candidate) => !candidate.done);
      if (!plan) break;
      continue;
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
 * 1. Fast search to get all recording IDs (up to 200)
 * 2. Do detailed lookups for first 20 recordings to get relationship data
 * 3. Return quickly with rich data for first page
 *
 * Query params:
 *   - name: The contributor's name (required)
 *   - limit: Number of recordings to return (default 20, max 50)
 *   - offset: Offset for pagination (default 0)
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const name = searchParams.get("name");
  const limitParam = searchParams.get("limit");
  const offsetParam = searchParams.get("offset");

  const limit = limitParam ? Math.min(parseInt(limitParam, 10), 50) : 20;
  const offset = offsetParam ? parseInt(offsetParam, 10) : 0;

  if (!name || typeof name !== "string" || name.trim().length === 0) {
    return NextResponse.json(
      { error: "Missing or invalid 'name' parameter" },
      { status: 400 },
    );
  }

  try {
    const mb = getMBClient();

    // Step 1: Find the artist by name to get their MBID
    const artistSearchResult = await mb.search("artist", {
      query: `artist:"${name.trim()}"`,
      limit: 5,
    });

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
    const topArtist = artists[0];
    const artistId = topArtist.id;
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

    const aliasCandidates = new Set<string>();
    const addAliasCandidate = (value?: string) => {
      if (typeof value !== "string") return;
      const trimmed = value.trim();
      if (trimmed.length === 0) return;
      aliasCandidates.add(trimmed);
    };

    addAliasCandidate(name);
    if (topArtist.name) {
      addAliasCandidate(topArtist.name);
    }

    let state = contributorCache.get(artistId);
    if (!state) {
      try {
        const fullArtist = await lookupArtist(artistId);
        if (fullArtist.name) {
          addAliasCandidate(fullArtist.name);
        }

        if (Array.isArray(fullArtist.aliases)) {
          for (const alias of fullArtist.aliases) {
            addAliasCandidate(alias.name);
          }
        }
      } catch {
        // If lookup fails, continue with the variants we already collected
      }

      state = buildContributorCache(artistId, Array.from(aliasCandidates));
      contributorCache.set(artistId, state);
    } else {
      for (const alias of aliasCandidates) {
        ensureStateHasAlias(state, alias);
      }
    }

    const neededCount = Math.min(
      Math.max(offset + limit, 0),
      MAX_CONTRIBUTOR_RECORDINGS,
    );
    await ensureMinimumRecordings(state, neededCount);

    if (state.recordings.length === 0) {
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

    // Step 3: For the requested page, do detailed lookups to get relationship data
    const totalRecordings = state.completed
      ? state.recordings.length
      : Math.max(state.recordings.length, neededCount);
    const pageRecordings = state.recordings.slice(offset, offset + limit);

    // Do detailed lookups in parallel for this page
    const detailedRecordings = await Promise.all(
      pageRecordings.map(async (rec) => {
        if (!rec.id) return rec;
        try {
          // Lookup with artist relationships to get detailed role information
          const detailed = await lookupRecording(rec.id);
          return detailed || rec;
        } catch {
          return rec; // Fallback to search result if lookup fails
        }
      })
    );

    // Build contributions list and aggregate roles
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

    for (const recording of detailedRecordings) {
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

    const hasMore =
      !state.completed || offset + limit < state.recordings.length;

    const profile: ContributorProfile = {
      name,
      totalContributions,
      totalRecordings,
      hasMore,
      roleBreakdown,
      contributions,
    };

    return NextResponse.json(profile);
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
