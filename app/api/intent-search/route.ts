import { NextResponse } from "next/server";
import { performance } from "node:perf_hooks";

import { searchCanonicalSong } from "@/lib/search";
import { searchContributorIntent } from "@/lib/search/searchContributorIntent";
import type { IntentSearchResponse } from "@/lib/search/intentTypes";
import type { SearchResponse, CanonicalResult } from "@/lib/search/types";

const SONG_CONFIDENCE = 92;
const CONTRIBUTOR_CONFIDENCE = 0.8;
const SONG_TIMEOUT_MS = 6000;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs);
    promise
      .then((result) => {
        clearTimeout(timer);
        resolve(result);
      })
      .catch(() => {
        clearTimeout(timer);
        resolve(null);
      });
  });
}

function logStep(step: string, start: number, extra: Record<string, unknown>) {
  const durationMs = performance.now() - start;
  console.log("[intent-search][perf]", {
    step,
    durationMs: Number(durationMs.toFixed(2)),
    ...extra,
  });
}

function extractRecordings(
  response: SearchResponse | null | undefined,
): CanonicalResult[] {
  if (!response) return [];
  if (response.mode === "canonical") {
    return [response.result];
  }
  return response.results;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q")?.trim();

  if (!q) {
    return NextResponse.json(
      { error: "Missing query parameter 'q'" },
      { status: 400 },
    );
  }

  try {
    const tokens = q.split(/\s+/).filter(Boolean);
    const looksLikePersonName =
      tokens.length >= 2 &&
      tokens.length <= 5 &&
      tokens.every((token) => /^[a-zA-ZÀ-ÖØ-öø-ÿ'.&-]+$/.test(token));

    // Run contributor and song searches in parallel for better performance
    const [contributorIntent, songResponse] = await Promise.all([
      (async () => {
        const contributorStart = performance.now();
        const result = await searchContributorIntent(q);
        logStep("contributor-intent", contributorStart, {
          candidates: result.candidates.length,
        });
        return result;
      })(),
      (async () => {
        const songStart = performance.now();
        const result = await withTimeout(searchCanonicalSong(q), SONG_TIMEOUT_MS);
        logStep("song-search", songStart, {
          timedOut: result === null,
          mode: result?.mode ?? "none",
        });
        return result;
      })(),
    ]);

    const [topContrib, secondContrib] = contributorIntent.candidates;

    const songIsStrong =
      songResponse?.mode === "canonical" &&
      (songResponse.result.confidenceScore ?? 0) >= SONG_CONFIDENCE;

    // Check if song search found multiple recordings (ambiguous but substantial results)
    const songHasMultipleResults =
      songResponse?.mode === "ambiguous" &&
      Array.isArray(songResponse.results) &&
      songResponse.results.length >= 3;

    const songWeakOrAmbiguous =
      !songResponse ||
      songResponse.mode !== "canonical" ||
      (songResponse.result.confidenceScore ?? 0) < SONG_CONFIDENCE;

    // Use the same contributor variables from above
    const contributorIsStrong =
      !!topContrib &&
      topContrib.score >= CONTRIBUTOR_CONFIDENCE &&
      // Either only one candidate, or top candidate has significantly higher score
      (contributorIntent.candidates.length === 1 ||
        !secondContrib ||
        topContrib.score - secondContrib.score >= 0.3);

    let payload: IntentSearchResponse;
    // Prefer songs over contributors when:
    // 1. Song is strong (canonical with high confidence), OR
    // 2. Song has multiple results (likely a well-known song title) AND contributor is just one match
    if (songIsStrong && songResponse?.mode === "canonical") {
      payload = {
        intent: "recording",
        recordingId: songResponse.result.id,
      };
    } else if (contributorIsStrong && songWeakOrAmbiguous && !songHasMultipleResults && topContrib) {
      // Only prefer contributor if song search found few/no results
      payload = {
        intent: "contributor",
        contributorId: topContrib.id,
        contributorName: topContrib.name,
      };
    } else {
      payload = {
        intent: "ambiguous",
        recordings: extractRecordings(songResponse),
        contributors: contributorIntent.candidates,
      };
    }

    return NextResponse.json(payload);
  } catch (error) {
    console.error("Intent search failed", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
