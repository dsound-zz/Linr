// lib/logger.ts
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import type { MusicBrainzSearchResponse, MusicBrainzRecording } from "./types";

const LOGS_DIR = join(process.cwd(), "logs");
const MUSICBRAINZ_LOG_FILE = join(LOGS_DIR, "musicbrainz.jsonl");

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

  const samples = recordings.slice(0, maxSamples).map((rec: any) => ({
    id: rec.id,
    title: rec.title,
    artist: rec.artist,
    score: rec.score,
  }));

  return {
    count: recordings.length,
    samples,
  };
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
    await ensureLogsDir();

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

    // Overwrite the file each time (not append)
    const line = JSON.stringify(logEntry, null, 2) + "\n";
    await writeFile(MUSICBRAINZ_LOG_FILE, line, { flag: "w" });
  } catch (error) {
    // Don't throw - logging failures shouldn't break the app
    console.error("Failed to log search debug info:", error);
  }
}
