/**
 * Canonical Song Search API Route
 *
 * Clean implementation using the refactored pipeline
 */

import { NextResponse } from "next/server";
import { searchCanonicalSong } from "@/lib/search";
import { logSearchDebugInfo } from "@/lib/logger";

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

      // Write debug info to JSONL file (overwrites each time)
      await logSearchDebugInfo(
        q,
        debugInfo,
        response?.mode === "canonical" ? response.result : response?.results,
      );
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
      return NextResponse.json({ mode: "canonical", results: [] });
    }

    if (response.mode === "canonical") {
      return NextResponse.json({
        mode: "canonical",
        results: [response.result],
      });
    }

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
