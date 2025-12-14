// lib/logger.ts
import { writeFile, mkdir, readFile } from "fs/promises";
import { join } from "path";
import type { MusicBrainzSearchResponse, MusicBrainzRecording } from "./types";

const LOGS_DIR = join(process.cwd(), "logs");
const MUSICBRAINZ_LOG_FILE = join(LOGS_DIR, "musicbrainz.jsonl");
const SEARCH_LOG_FILE = join(LOGS_DIR, "search.jsonl");
const CREDITS_LOG_FILE = join(LOGS_DIR, "credits.jsonl");

interface MusicBrainzLogEntry {
  timestamp: string;
  endpoint: "search" | "lookup";
  query?: string; // for search
  id?: string; // for lookup
  rawResponse: MusicBrainzSearchResponse | MusicBrainzRecording;
}

/**
 * Ensures the logs directory exists
 */
async function ensureLogsDir(): Promise<void> {
  try {
    await mkdir(LOGS_DIR, { recursive: true });
  } catch (error) {
    // Directory might already exist, that's fine
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
      throw error;
    }
  }
}

async function readJsonlLines(filePath: string): Promise<string[]> {
  try {
    const raw = await readFile(filePath, "utf8");
    return raw
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function writeJsonlCapped(
  filePath: string,
  entry: unknown,
  maxEntries = 3,
): Promise<void> {
  await ensureLogsDir();

  // NOTE: We intentionally store one JSON object per line (single-line JSON)
  // so we can cap by line count.
  const existing = await readJsonlLines(filePath);
  const next = [
    ...existing.slice(Math.max(0, existing.length - (maxEntries - 1))),
    JSON.stringify(entry),
  ];
  await writeFile(filePath, next.join("\n") + "\n", { flag: "w" });
}

/**
 * Logs a MusicBrainz API response to a JSONL file
 */
export async function logMusicBrainzResponse(
  endpoint: "search" | "lookup",
  rawResponse: MusicBrainzSearchResponse | MusicBrainzRecording,
  query?: string,
  id?: string,
): Promise<void> {
  try {
    await ensureLogsDir();

    const logEntry: MusicBrainzLogEntry = {
      timestamp: new Date().toISOString(),
      endpoint,
      rawResponse,
    };

    if (query) {
      logEntry.query = query;
    }

    if (id) {
      logEntry.id = id;
    }

    // Append to JSONL file (one JSON object per line)
    const line = JSON.stringify(logEntry, null, 2) + "\n";
    await writeFile(MUSICBRAINZ_LOG_FILE, line, { flag: "a" });
  } catch (error) {
    // Don't throw - logging failures shouldn't break the app
    console.error("Failed to log MusicBrainz response:", error);
  }
}

/**
 * Summarizes arrays of recordings to just counts and sample titles
 */
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

/**
 * Logs a search query (always) to a capped JSONL file.
 * Keeps only the last 3 entries to avoid growing without bound.
 */
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

    await writeJsonlCapped(SEARCH_LOG_FILE, entry, 3);
  } catch (error) {
    console.error("Failed to log search query:", error);
  }
}

/**
 * Logs search pipeline debug info to a JSONL file, overwriting each time
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
    // Summarize large arrays to keep file size manageable
    const summarizedDebugInfo = {
      stages: {
        ...debugInfo.stages,
        // Replace full arrays with summaries
        recordings: summarizeRecordings(
          debugInfo.stages.recordings as unknown[],
        ),
        filtered: summarizeRecordings(debugInfo.stages.filtered as unknown[]),
        scored: summarizeRecordings(debugInfo.stages.scored as unknown[]),
        results: summarizeRecordings(debugInfo.stages.results as unknown[]),
      },
      candidates: debugInfo.candidates,
    };

    const logEntry = {
      timestamp: new Date().toISOString(),
      query,
      debugInfo: summarizedDebugInfo,
      result,
    };

    // Keep only the last 3 debug entries.
    await writeJsonlCapped(SEARCH_LOG_FILE, logEntry, 3);
  } catch (error) {
    // Don't throw - logging failures shouldn't break the app
    console.error("Failed to log search debug info:", error);
  }
}

function summarizeCredits(normalized: unknown): unknown {
  const root = (normalized ?? {}) as Record<string, unknown>;
  const credits = (root.credits ?? {}) as Record<string, unknown>;
  const inferredRoot = (root.inferred ?? {}) as Record<string, unknown>;
  const inferred = (inferredRoot.credits ?? {}) as Record<string, unknown>;

  const performers = Array.isArray(credits.performers)
    ? credits.performers
    : [];
  const inferredPerformers = Array.isArray(inferred.performers)
    ? inferred.performers
    : [];

  const safeLen = (v: unknown): number => (Array.isArray(v) ? v.length : 0);

  return {
    title: (root.title as string | null | undefined) ?? null,
    artist: (root.artist as string | null | undefined) ?? null,
    year: (() => {
      const release = (root.release ?? {}) as Record<string, unknown>;
      const date = release.date;
      return date ? String(date).slice(0, 4) : null;
    })(),
    counts: {
      writers: safeLen(credits.writers),
      composers: safeLen(credits.composers),
      lyricists: safeLen(credits.lyricists),
      producers: safeLen(credits.producers),
      recording_engineers: safeLen(credits.recording_engineers),
      mixing_engineers: safeLen(credits.mixing_engineers),
      mastering_engineers: safeLen(credits.mastering_engineers),
      performers: performers.length,
    },
    inferredCounts: {
      writers: safeLen(inferred.writers),
      producers: safeLen(inferred.producers),
      performers: inferredPerformers.length,
    },
  };
}

/**
 * Logs credits payloads returned by /api/recording to a capped JSONL file.
 * Keeps only the last 3 entries to avoid growing without bound.
 */
export async function logCreditsResponse(params: {
  id: string;
  allowInferred: boolean;
  normalized: unknown;
}): Promise<void> {
  try {
    const entry = {
      timestamp: new Date().toISOString(),
      id: params.id,
      allowInferred: params.allowInferred,
      summary: summarizeCredits(params.normalized),
    };
    await writeJsonlCapped(CREDITS_LOG_FILE, entry, 3);
  } catch (error) {
    console.error("Failed to log credits response:", error);
  }
}
