/**
 * wikipedia.ts (OPTIONAL, late stage)
 *
 * Used ONLY if:
 * - result confidence is low
 * - or query is single-word and ambiguous
 *
 * Purpose: validate mainstream recognition
 * NOT used for filtering
 */

const cache = new Map<string, Promise<WikipediaResult | null>>();

export interface WikipediaResult {
  id: string;
  title: string;
  artist: string;
  year: string | null;
  source: "wikipedia";
}

/**
 * Search Wikipedia for a song to validate mainstream recognition
 * Returns null if not found or if search fails
 */
export async function searchWikipediaTrack(
  query: string,
): Promise<WikipediaResult | null> {
  const key = query.toLowerCase().trim();
  if (cache.has(key)) {
    return await cache.get(key)!;
  }

  const task = (async () => {
    try {
      const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(
        query,
      )}&format=json&srlimit=1`;
      const res = await fetch(searchUrl);
      if (!res.ok) return null;

      const json = (await res.json()) as any;
      const first = json?.query?.search?.[0];
      if (!first?.title) return null;

      const summaryUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(
        first.title,
      )}`;
      const sRes = await fetch(summaryUrl);
      if (!sRes.ok) return null;

      const summary = (await sRes.json()) as any;

      // Parse artist from summary
      let artist = parseSummaryArtist(summary?.extract);

      // If no artist found, try parsing from page title (e.g., "Jump (Van Halen song)")
      if (!artist) {
        artist = parseTitleArtist(summary?.title ?? first.title);
      }

      // If still no artist, check if this is a disambiguation page
      if (
        !artist &&
        summary?.extract?.toLowerCase().includes("disambiguation")
      ) {
        // For disambiguation pages, return null (don't return "Unknown artist")
        return null;
      }

      // Only return "Unknown artist" as last resort
      artist = artist ?? "Unknown artist";
      const year = parseSummaryYear(summary?.extract);

      return {
        id: `wiki:${summary?.pageid ?? first.pageid ?? first.title}`,
        title: summary?.title ?? first.title,
        artist,
        year,
        source: "wikipedia" as const,
      };
    } catch (err) {
      console.error("Wikipedia search failed", err);
      return null;
    }
  })();

  cache.set(key, task);
  return await task;
}

/**
 * Parse artist from Wikipedia summary
 * Pattern: "<Title> is a song by Artist ..."
 */
function parseSummaryArtist(summary: string | undefined): string | null {
  if (!summary) return null;
  const match = summary.match(/song by\s+([^.]+)/i);
  return match ? match[1].trim() : null;
}

/**
 * Parse artist from Wikipedia page title
 * Pattern: "Song (Artist song)" or "Song (Artist)"
 */
function parseTitleArtist(title: string | undefined): string | null {
  if (!title) return null;
  // Match pattern like "Jump (Van Halen song)" or "Jump (Van Halen)"
  const match = title.match(/\(([^)]+?)(?:\s+song)?\)$/);
  return match ? match[1].trim() : null;
}

/**
 * Parse year from Wikipedia summary
 */
function parseSummaryYear(summary: string | undefined): string | null {
  if (!summary) return null;
  const match = summary.match(/(19|20)\d{2}/);
  return match ? match[0] : null;
}
