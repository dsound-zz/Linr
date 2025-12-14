import { mkdir, readFile, writeFile } from "fs/promises";
import { join } from "path";

export const LOGS_DIR = join(process.cwd(), "logs");

/**
 * Ensures the logs directory exists.
 */
export async function ensureLogsDir(): Promise<void> {
  try {
    await mkdir(LOGS_DIR, { recursive: true });
  } catch (error) {
    // Directory might already exist, that's fine
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
      throw error;
    }
  }
}

export async function readJsonlLines(filePath: string): Promise<string[]> {
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

/**
 * Writes a JSONL file capped to the last N entries.
 *
 * NOTE: We intentionally store each entry as single-line JSON, one per line,
 * so we can cap by line count.
 */
export async function writeJsonlCapped(params: {
  filePath: string;
  entry: unknown;
  maxEntries?: number;
}): Promise<void> {
  const { filePath, entry, maxEntries = 3 } = params;
  await ensureLogsDir();

  const existing = await readJsonlLines(filePath);
  const next = [
    ...existing.slice(Math.max(0, existing.length - (maxEntries - 1))),
    JSON.stringify(entry),
  ];
  await writeFile(filePath, next.join("\n") + "\n", { flag: "w" });
}
