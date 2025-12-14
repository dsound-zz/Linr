/**
 * Canonical Song Search API Route
 *
 * Clean implementation using the refactored pipeline
 */

import { NextResponse } from "next/server";
import { searchCanonicalSong } from "@/lib/search";
import { logSearchQuery } from "@/lib/logger";

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
    if (debug) {
      console.log("[SEARCH] Debug mode enabled for query:", q);
      const { response, debugInfo } = await searchCanonicalSong(
        q,
        true as const,
      );
      console.log("[SEARCH] Debug info:", JSON.stringify(debugInfo, null, 2));

      // Log last 3 search queries (with debug summary)
      await logSearchQuery({ query: q, response, debugInfo });
      if (!response) {
        return NextResponse.json({ mode: "canonical", results: [], debugInfo });
      }
      if (response.mode === "canonical") {
        return NextResponse.json({
          mode: "canonical",
          results: [response.result],
          debugInfo,
        });
      }
      return NextResponse.json({
        mode: "ambiguous",
        results: response.results,
        debugInfo,
      });
    }

    const response = await searchCanonicalSong(q);

    if (!response) {
      await logSearchQuery({ query: q, response: null });
      return NextResponse.json({ mode: "canonical", results: [] });
    }

    if (response.mode === "canonical") {
      await logSearchQuery({ query: q, response });
      return NextResponse.json({
        mode: "canonical",
        results: [response.result],
      });
    }

    await logSearchQuery({ query: q, response });
    return NextResponse.json({
      mode: "ambiguous",
      results: response.results,
    });
  } catch (error) {
    console.error("Search error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
