import { writeFile } from "fs/promises";
import { join } from "path";
import type { MusicBrainzRecording, MusicBrainzSearchResponse } from "../types";
import { ensureLogsDir, LOGS_DIR } from "./jsonl";

const MUSICBRAINZ_LOG_FILE = join(LOGS_DIR, "musicbrainz.jsonl");

interface MusicBrainzLogEntry {
  timestamp: string;
  endpoint: "search" | "lookup";
  query?: string;
  id?: string;
  rawResponse: MusicBrainzSearchResponse | MusicBrainzRecording;
}

/**
 * Logs a MusicBrainz API response to a JSONL file (append-only).
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

    // Keep the existing pretty JSON format for readability.
    const line = JSON.stringify(logEntry, null, 2) + "\n";
    await writeFile(MUSICBRAINZ_LOG_FILE, line, { flag: "a" });
  } catch (error) {
    // Don't throw - logging failures shouldn't break the app
    console.error("Failed to log MusicBrainz response:", error);
  }
}
