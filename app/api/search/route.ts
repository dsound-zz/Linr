import { NextResponse } from "next/server";
import { searchCanonicalSong } from "@/lib/search";
import { logSearchQuery } from "@/lib/logger";
import { inferSearchIntent } from "@/lib/search/inferIntent";
import { searchContributorsByName } from "@/lib/search/searchContributors";
import type { ContributorResult, SongResult } from "@/lib/types";
import type { CanonicalResult, SearchResponse } from "@/lib/search/types";

type SearchMode = "canonical" | "ambiguous";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q");
  const debug =
    searchParams.get("debug") === "1" || searchParams.get("debug") === "true";

  if (!q) {
    return NextResponse.json(
      { error: "Missing query parameter 'q'" },
      { status: 400 },
    );
  }

  try {
    const intentResolution = await inferSearchIntent(q);

    if (intentResolution.intent.type === "contributor") {
      const contributors =
        intentResolution.contributorMatches.length > 0
          ? intentResolution.contributorMatches
          : await searchContributorsByName(intentResolution.intent.name, {
              limit: 5,
            });

      return NextResponse.json({
        intent: "contributor" as const,
        mode: "ambiguous" as SearchMode,
        results: contributors.map(mapContributorResult),
      });
    }

    if (debug) {
      console.log("[SEARCH] Debug mode enabled for query:", q);
      const { response, debugInfo } = await searchCanonicalSong(
        q,
        true as const,
      );
      await logSearchQuery({ query: q, response, debugInfo });

      const { mode, results } = normalizeSongResponse(response);
      return NextResponse.json({
        intent: "song" as const,
        mode,
        results,
        debugInfo,
      });
    }

    const response = await searchCanonicalSong(q);

    await logSearchQuery({ query: q, response });
    const { mode, results } = normalizeSongResponse(response);
    return NextResponse.json({
      intent: "song" as const,
      mode,
      results,
    });
  } catch (error) {
    console.error("Search error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

function mapContributorResult(
  contributor: {
    artistMBID: string;
    name: string;
    roles: string[];
    area?: string | null;
  },
): ContributorResult {
  return {
    entityType: "contributor",
    artistName: contributor.name,
    artistMBID: contributor.artistMBID,
    primaryRoles: contributor.roles.length > 0 ? contributor.roles : undefined,
    area: contributor.area ?? null,
  };
}

function normalizeSongResponse(
  response: SearchResponse | null | undefined,
): { mode: SearchMode; results: SongResult[] } {
  if (!response) {
    return { mode: "ambiguous", results: [] };
  }

  if (response.mode === "canonical") {
    const filtered = mapSongResults([response.result]);
    if (filtered.length === 0) {
      return { mode: "ambiguous", results: [] };
    }
    return { mode: "canonical", results: filtered };
  }

  return {
    mode: "ambiguous",
    results: mapSongResults(response.results),
  };
}

function mapSongResults(results: CanonicalResult[]): SongResult[] {
  return results
    .filter(
      (result) =>
        result.entityType === "recording" || result.entityType === "album_track",
    )
    .map((result) => ({
      entityType: result.entityType,
      title: result.title,
      artist: result.artist,
      recordingMBID: result.id,
      year: result.year ? parseInt(result.year, 10) || null : null,
    }));
}
