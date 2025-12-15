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

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  const source = searchParams.get("source");
  // Default to inferred credits on; allow explicit opt-out with inferred=0/false
  const inferredParam = searchParams.get("inferred");
  const allowInferred =
    inferredParam == null ||
    inferredParam === "" ||
    inferredParam === "1" ||
    inferredParam.toLowerCase() === "true";

  if (!id) {
    return NextResponse.json(
      { error: "Missing 'id' query parameter" },
      { status: 400 },
    );
  }

  // Only allow MusicBrainz lookup for MusicBrainz sources
  // Allow undefined/null source for backward compatibility
  if (id.startsWith("wiki:") || (source && source !== "musicbrainz")) {
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
    const raw = await lookupRecording(id);

    // Pull the primary release and release-group to harvest additional relations
    const releases = Array.isArray(raw.releases) ? raw.releases : [];

    // Prefer an Album release that is not a compilation for primary cover art/context.
    const primaryRelease =
      releases.find((r) => {
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

        const isAlbum = (primaryType ?? "").toLowerCase() === "album";
        const isCompilation = Array.isArray(secondaryTypes)
          ? secondaryTypes.some(
              (t) => (t ?? "").toLowerCase() === "compilation",
            )
          : false;
        return isAlbum && !isCompilation;
      }) ?? releases[0];

    const release = primaryRelease?.id
      ? await lookupRelease(primaryRelease.id)
      : null;
    const releaseGroupId =
      release?.["release-group"]?.id ??
      primaryRelease?.["release-group"]?.id ??
      null;
    const releaseGroup = releaseGroupId
      ? await lookupReleaseGroup(releaseGroupId)
      : null;

    const clean = await normalizeRecording(raw, {
      release,
      releaseGroup,
      allowInferred,
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
          const titleForSearch = (clean.title ?? "").replace(/’/g, "'");
          const artistForSearch = (clean.artist ?? "").replace(/’/g, "'");
          const candidates = await searchByTitleAndArtist(
            titleForSearch,
            artistForSearch,
            10,
          );

          const MAX_ALT_LOOKUPS = 3;
          let used = 0;
          let merged = clean.credits.performers;

          for (const c of candidates) {
            if (!c?.id || c.id === id) continue;
            used++;
            if (used > MAX_ALT_LOOKUPS) break;

            const altRaw = await lookupRecording(c.id);
            const altDerived = deriveRecordingFromMB(altRaw, null, null);
            if (altDerived.credits.performers?.length) {
              merged = mergePerformers(merged, altDerived.credits.performers);
            }
            if (merged.length >= PERFORMER_ENRICH_THRESHOLD) break;
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
    return NextResponse.json(clean);
  } catch (err) {
    console.error("Recording error:", err);
    return NextResponse.json(
      { error: "Failed to fetch recording details" },
      { status: 500 },
    );
  }
}
