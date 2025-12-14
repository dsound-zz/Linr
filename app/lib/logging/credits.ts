import { join } from "path";
import { LOGS_DIR, writeJsonlCapped } from "./jsonl";

const CREDITS_LOG_FILE = join(LOGS_DIR, "credits.jsonl");

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

    await writeJsonlCapped({
      filePath: CREDITS_LOG_FILE,
      entry,
      maxEntries: 3,
    });
  } catch (error) {
    console.error("Failed to log credits response:", error);
  }
}
