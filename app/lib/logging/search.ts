import { join } from "path";
import { LOGS_DIR, writeJsonlCapped } from "./jsonl";

const SEARCH_LOG_FILE = join(LOGS_DIR, "search.jsonl");

function summarizeRecordings(
  recordings: unknown[] | undefined,
  maxSamples = 5,
): unknown {
  if (!Array.isArray(recordings) || recordings.length === 0) {
    return { count: 0, samples: [] };
  }

  const samples = recordings.slice(0, maxSamples).map((rec) => {
    const r = rec as Record<string, unknown>;
    return {
      id: r.id,
      title: r.title,
      artist: r.artist,
      score: r.score,
    };
  });

  return {
    count: recordings.length,
    samples,
  };
}

function summarizeSearchResults(results: unknown, max = 5): unknown {
  if (!Array.isArray(results) || results.length === 0) return [];
  return results.slice(0, max).map((item) => {
    const r = item as Record<string, unknown>;
    return {
      id: r.id,
      title: r.title,
      artist: r.artist,
      year: (r.year as string | null | undefined) ?? null,
      releaseTitle: (r.releaseTitle as string | null | undefined) ?? null,
      score:
        (r.confidenceScore as number | null | undefined) ??
        (r.score as number | null | undefined) ??
        null,
      entityType: (r.entityType as string | null | undefined) ?? null,
      source: (r.source as string | null | undefined) ?? null,
    };
  });
}

export async function logSearchQuery(params: {
  query: string;
  response: unknown;
  debugInfo?: {
    stages: Record<string, unknown>;
    candidates: Record<string, unknown>;
  } | null;
}): Promise<void> {
  try {
    const { query, response, debugInfo } = params;
    const resp = response as Record<string, unknown> | null;
    const mode = (resp?.mode as string | null | undefined) ?? null;
    const results =
      mode === "canonical"
        ? resp?.result
          ? [resp.result]
          : []
        : ((resp?.results as unknown[] | undefined) ?? []);

    const entry = {
      timestamp: new Date().toISOString(),
      query,
      mode,
      results: summarizeSearchResults(results, 5),
      debug: debugInfo
        ? {
            stages: {
              ...debugInfo.stages,
              recordings: summarizeRecordings(
                debugInfo.stages.recordings as unknown[],
              ),
              filtered: summarizeRecordings(
                debugInfo.stages.filtered as unknown[],
              ),
              scored: summarizeRecordings(debugInfo.stages.scored as unknown[]),
              results: summarizeRecordings(
                debugInfo.stages.results as unknown[],
              ),
            },
          }
        : null,
    };

    await writeJsonlCapped({ filePath: SEARCH_LOG_FILE, entry, maxEntries: 3 });
  } catch (error) {
    console.error("Failed to log search query:", error);
  }
}

/**
 * Legacy helper: logs summarized debug info to the same capped search log.
 */
export async function logSearchDebugInfo(
  query: string,
  debugInfo: {
    stages: Record<string, unknown>;
    candidates: Record<string, unknown>;
  },
  result: unknown,
): Promise<void> {
  try {
    const summarizedDebugInfo = {
      stages: {
        ...debugInfo.stages,
        recordings: summarizeRecordings(
          debugInfo.stages.recordings as unknown[],
        ),
        filtered: summarizeRecordings(debugInfo.stages.filtered as unknown[]),
        scored: summarizeRecordings(debugInfo.stages.scored as unknown[]),
        results: summarizeRecordings(debugInfo.stages.results as unknown[]),
      },
      candidates: debugInfo.candidates,
    };

    const entry = {
      timestamp: new Date().toISOString(),
      query,
      debugInfo: summarizedDebugInfo,
      result,
    };

    await writeJsonlCapped({ filePath: SEARCH_LOG_FILE, entry, maxEntries: 3 });
  } catch (error) {
    console.error("Failed to log search debug info:", error);
  }
}
