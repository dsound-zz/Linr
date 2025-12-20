import { NextResponse } from "next/server";
import {
    lookupRecording,
    lookupRelease,
    lookupReleaseGroup,
} from "@/lib/musicbrainz";
import { deriveRecordingFromMB, normalizeRecording } from "@/lib/openai";
import { logCreditsResponse } from "@/lib/logger";
import { cacheKeyRecording, getCached, setCached } from "@/lib/search/cache";
import { searchByTitleAndArtist } from "@/lib/search/search";
import { fetchDiscogsCreditsDebug } from "@/lib/discogs";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  const source = searchParams.get("source");
  const debug =
    searchParams.get("debug") === "1" ||
    (searchParams.get("debug") ?? "").toLowerCase() === "true";
  // Optional toggles:
  // - inferred: OpenAI inferred credits (slow), default on for backward compat.
  // - ai: OpenAI normalization step (slow), default on for backward compat.
  // - external: Wikipedia personnel enrichment (can be slow), default on.
  const inferredParam = searchParams.get("inferred");
  const allowInferred =
    inferredParam == null ||
    inferredParam === "" ||
    inferredParam === "1" ||
    inferredParam.toLowerCase() === "true";
  const aiParam = searchParams.get("ai");
  const allowAI =
    aiParam == null ||
    aiParam === "" ||
    aiParam === "1" ||
    aiParam.toLowerCase() === "true";
  const externalParam = searchParams.get("external");
  const allowExternal =
    externalParam == null ||
    externalParam === "" ||
    externalParam === "1" ||
    externalParam.toLowerCase() === "true";

  // For debugging: bypass cached normalized payload.
  const noCacheParam = searchParams.get("nocache");
  const bypassCache =
    noCacheParam === "1" || (noCacheParam ?? "").toLowerCase() === "true";

  if (!id) {
    return NextResponse.json(
      { error: "Missing 'id' query parameter" },
      { status: 400 },
    );
  }

  // Only allow MusicBrainz lookup for MusicBrainz sources (including OpenAI-reranked)
  // Allow undefined/null source for backward compatibility
  if (id.startsWith("wiki:") || (source && source !== "musicbrainz" && source !== "musicbrainz+openai")) {
    return NextResponse.json(
      {
        error: "Lookup is only supported for MusicBrainz sources",
        id,
        source: source || null,
      },
      { status: 400 },
    );
  }

  try {
    // Cache the full normalized payload (best-effort). This dramatically speeds up
    // repeat navigations and back/forward.
    // Bump to invalidate normalized payload caches when enrichment logic changes.
    const RECORDING_CACHE_VERSION = 7; // Bumped to include outbound links in normalized payload
    const fullCacheKey = cacheKeyRecording(
      `recording:v${RECORDING_CACHE_VERSION}:${id}:ai:${allowAI}:external:${allowExternal}:inferred:${allowInferred}`,
    );
    if (!bypassCache) {
      const cachedFull = await getCached<unknown>(fullCacheKey);
      if (cachedFull && typeof cachedFull === "object") {
        return NextResponse.json(cachedFull);
      }
    }

    // PERFORMANCE: Fetch recording first, then parallelize release/release-group lookups
    const raw = await lookupRecording(id);

    // Pull the primary release and release-group to harvest additional relations
    const releases = Array.isArray(raw.releases) ? raw.releases : [];

    // Pick a "best" primary release for cover art + relationship harvesting.
    // Prefer studio albums and strongly avoid compilations/"best of" even when
    // MusicBrainz release-group secondary-types are incomplete.
    const scoreRelease = (r: (typeof releases)[number]) => {
      const rg = r?.["release-group"];
      const primaryType =
        rg && typeof rg === "object"
          ? ((rg as Record<string, unknown>)["primary-type"] as
              | string
              | undefined)
          : undefined;
      const secondaryTypes =
        rg && typeof rg === "object"
          ? ((rg as Record<string, unknown>)["secondary-types"] as
              | string[]
              | undefined)
          : undefined;

      const primary = (primaryType ?? "").toLowerCase();
      const secondary = Array.isArray(secondaryTypes)
        ? secondaryTypes.map((t) => (t ?? "").toLowerCase())
        : [];

      const title = (r?.title ?? "").toLowerCase();
      const isCompilation =
        primary === "compilation" || secondary.includes("compilation");

      // Heuristic "compilation-ish" titles (covers cases where MB types are missing).
      const looksLikeCompilationTitle =
        /(greatest hits|best of|hits\b|the hits|collection|anthology|essential|karaoke|tribute)/i.test(
          title,
        );

      const yearStr =
        typeof r?.date === "string" && r.date.length >= 4
          ? r.date.slice(0, 4)
          : null;
      const year = yearStr ? Number(yearStr) : null;

      let score = 0;
      if (primary === "album") score += 50;
      else if (primary === "single") score += 20;
      else if (primary === "ep") score += 10;

      if (!isCompilation) score += 25;
      if (isCompilation) score -= 200;
      if (looksLikeCompilationTitle) score -= 150;

      if ((r?.country ?? "").toUpperCase() === "US") score += 5;

      // Prefer earlier releases when otherwise comparable.
      if (year != null && !Number.isNaN(year)) {
        score += Math.max(0, 30 - Math.min(30, Math.max(0, year - 1960) / 2));
      }

      return score;
    };

    const primaryRelease =
      releases.slice().sort((a, b) => scoreRelease(b) - scoreRelease(a))[0] ??
      releases[0];

    // For display purposes, prefer the earliest non-compilation album/single
    // This ensures users see the original release, not a compilation version
    const selectDisplayRelease = (rels: typeof releases) => {
      // Filter to non-compilations first
      const nonCompilations = rels.filter((r) => {
        const rg = r?.["release-group"];
        const primaryType =
          rg && typeof rg === "object"
            ? ((rg as Record<string, unknown>)["primary-type"] as
                | string
                | undefined)
            : undefined;
        const secondaryTypes =
          rg && typeof rg === "object"
            ? ((rg as Record<string, unknown>)["secondary-types"] as
                | string[]
                | undefined)
            : undefined;

        const primary = (primaryType ?? "").toLowerCase();
        const secondary = Array.isArray(secondaryTypes)
          ? secondaryTypes.map((t) => (t ?? "").toLowerCase())
          : [];

        const isCompilation =
          primary === "compilation" || secondary.includes("compilation");

        const title = (r?.title ?? "").toLowerCase();
        const looksLikeCompilationTitle =
          /(greatest hits|best of|hits\b|the hits|collection|anthology|essential|karaoke|tribute)/i.test(
            title,
          );

        return !isCompilation && !looksLikeCompilationTitle;
      });

      // Prefer albums and singles over other types
      const albumsOrSingles = nonCompilations.filter((r) => {
        const rg = r?.["release-group"];
        const primaryType =
          rg && typeof rg === "object"
            ? ((rg as Record<string, unknown>)["primary-type"] as
                | string
                | undefined)
            : undefined;
        const primary = (primaryType ?? "").toLowerCase();
        return primary === "album" || primary === "single";
      });

      const candidates = albumsOrSingles.length > 0 ? albumsOrSingles : nonCompilations;

      if (candidates.length === 0) return rels[0];

      // Sort by date (earliest first)
      return candidates.sort((a, b) => {
        const dateA = a?.date ?? "";
        const dateB = b?.date ?? "";
        return dateA.localeCompare(dateB);
      })[0];
    };

    const displayRelease = selectDisplayRelease(releases);

    // PERFORMANCE: Parallelize release and release-group lookups
    const releaseGroupIdFromRaw =
      primaryRelease?.["release-group"]?.id ?? null;

    const [release, releaseGroupFromDirect] = await Promise.all([
      displayRelease?.id ? lookupRelease(displayRelease.id) : Promise.resolve(null),
      releaseGroupIdFromRaw ? lookupReleaseGroup(releaseGroupIdFromRaw) : Promise.resolve(null),
    ]);

    // If release lookup returned a release-group ID not in raw data, fetch it
    const releaseGroupIdFromRelease = release?.["release-group"]?.id;
    const releaseGroup = releaseGroupFromDirect ??
      (releaseGroupIdFromRelease && releaseGroupIdFromRelease !== releaseGroupIdFromRaw
        ? await lookupReleaseGroup(releaseGroupIdFromRelease)
        : null);

    const clean = await normalizeRecording(raw, {
      release,
      releaseGroup,
      allowAI,
      allowInferred,
      allowExternal,
    });

    // If this recording has sparse performer credits, opportunistically merge
    // additional performers from alternate MusicBrainz recordings with the same
    // title+artist. This does NOT affect search ranking/selection; it only enriches
    // the detail view.
    const PERFORMER_ENRICH_THRESHOLD = 5;
    if ((clean.credits.performers?.length ?? 0) < PERFORMER_ENRICH_THRESHOLD) {
      const key = cacheKeyRecording(`performers-enrich:${id}`);
      const cached = await getCached<typeof clean.credits.performers>(key);

      const mergePerformers = (
        base: typeof clean.credits.performers,
        incoming: typeof clean.credits.performers,
      ) => {
        const seen = new Set(base.map((p) => `${p.name}::${p.role}`));
        const out = [...base];
        for (const p of incoming) {
          const k = `${p.name}::${p.role}`;
          if (seen.has(k)) continue;
          seen.add(k);
          out.push(p);
        }
        return out;
      };

      if (cached && Array.isArray(cached)) {
        clean.credits.performers = mergePerformers(
          clean.credits.performers,
          cached,
        );
      } else {
        try {
          const titleForSearch = (clean.title ?? "").replace(/'/g, "'");
          const artistForSearch = (clean.artist ?? "").replace(/'/g, "'");

          // PERFORMANCE: Reduced limit from 10 to 4 since we only use top 3
          const candidates = await searchByTitleAndArtist(
            titleForSearch,
            artistForSearch,
            4,
          );

          const MAX_ALT_LOOKUPS = 3;

          // Filter candidates to ensure c.id is present and not the current recording
          const candidatesToLookup = candidates
            .filter(c => c?.id && c.id !== id)
            .slice(0, MAX_ALT_LOOKUPS) as Array<{ id: string }>;

          // PERFORMANCE: Fetch sequentially with early exit instead of parallel
          // This avoids unnecessary lookups when early candidates provide enough performers
          let merged = clean.credits.performers;
          for (const candidate of candidatesToLookup) {
            try {
              const altRaw = await lookupRecording(candidate.id);
              if (!altRaw) continue;

              const altDerived = deriveRecordingFromMB(altRaw, null, null);
              if (altDerived.credits.performers?.length) {
                merged = mergePerformers(merged, altDerived.credits.performers);
              }

              // Early exit if we've reached our threshold
              if (merged.length >= PERFORMER_ENRICH_THRESHOLD) break;
            } catch {
              // Continue to next candidate on error
              continue;
            }
          }

          clean.credits.performers = merged;
          await setCached(key, merged);
        } catch {
          // Best-effort only; never fail the request due to enrichment.
        }
      }
    }

    // Log last 3 credits payloads returned (summary only)
    await logCreditsResponse({ id, allowInferred, normalized: clean });
    void setCached(fullCacheKey, clean);
    if (debug) {
      // Best-effort: help diagnose whether Discogs is being used + what it returns.
      // Never include the token itself in responses.
      let discogs: unknown = null;
      try {
        discogs = await fetchDiscogsCreditsDebug({
          artist: clean.artist ?? "",
          title: clean.title ?? "",
          releaseTitle: clean.release?.title ?? null,
        });
      } catch {
        discogs = null;
      }
      return NextResponse.json({
        ...clean,
        _debug: {
          allowAI,
          allowExternal,
          allowInferred,
          discogsTokenPresent: Boolean(process.env.DISCOGS_TOKEN),
          discogs,
        },
      });
    }

    return NextResponse.json(clean);
  } catch (err) {
    console.error("Recording error:", err);
    return NextResponse.json(
      { error: "Failed to fetch recording details" },
      { status: 500 },
    );
  }
}
