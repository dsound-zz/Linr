const cache = new Map<string, Promise<{ personnel: { name: string; role: string }[] }>>();
const searchCache = new Map<string, Promise<any | null>>();

function decodeHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&rsquo;/g, "'")
    .replace(/&ldquo;/g, '"')
    .replace(/&rdquo;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function extractPersonnelFromHtml(html: string): { name: string; role: string }[] {
  const lower = html.toLowerCase();
  const headingRegex =
    /<h[2-4][^>]*>\s*<span[^>]*id="[^"]*personnel[^"]*"[^>]*>.*?<\/span>\s*<\/h[2-4]>/i;
  const headingMatch = headingRegex.exec(html);
  if (!headingMatch) return [];

  const start = headingMatch.index + headingMatch[0].length;
  const nextHeadingIdx = lower.indexOf("<h2", start);
  const section =
    nextHeadingIdx === -1 ? html.slice(start) : html.slice(start, nextHeadingIdx);

  const items: { name: string; role: string }[] = [];
  const liRegex = /<li[^>]*>([\s\S]*?)<\/li>/gi;
  let m: RegExpExecArray | null;
  while ((m = liRegex.exec(section))) {
    const text = decodeHtml(m[1]);
    if (!text) continue;

    // Split on first dash/en dash
    const split = text.split(/–|-/, 2);
    if (split.length === 2) {
      const name = split[0].trim();
      const roles = split[1].split(/,|;|\//).map((r) => r.trim()).filter(Boolean);
      if (name) {
        if (roles.length === 0) {
          items.push({ name, role: "personnel" });
        } else {
          roles.forEach((role) => items.push({ name, role }));
        }
      }
    } else {
      items.push({ name: text, role: "personnel" });
    }
  }

  return items;
}

async function fetchWikipediaPageTitle(title: string, artist: string): Promise<string | null> {
  const candidates = [
    `${title} ${artist} song`,
    `${title} ${artist}`,
    `${title} song`,
    title,
  ];

  for (const query of candidates) {
    const url = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(
      query,
    )}&format=json&srlimit=1`;
    const res = await fetch(url);
    if (!res.ok) continue;
    const json = (await res.json()) as any;
    const first = json?.query?.search?.[0];
    if (first?.title) return first.title;
  }

  return null;
}

export async function getWikipediaPersonnel(
  title: string,
  artist: string,
): Promise<{ name: string; role: string }[]> {
  const key = `${title}::${artist}`.toLowerCase().trim();
  if (cache.has(key)) {
    return (await cache.get(key)!)?.personnel ?? [];
  }

  const task = (async () => {
    const pageTitle = await fetchWikipediaPageTitle(title, artist);
    if (!pageTitle) return { personnel: [] };

    const url = `https://en.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(
      pageTitle,
    )}&prop=text&format=json&formatversion=2`;
    const res = await fetch(url);
    if (!res.ok) return { personnel: [] };
    const json = (await res.json()) as any;
    const html = json?.parse?.text;
    if (!html || typeof html !== "string") return { personnel: [] };

    const personnel = extractPersonnelFromHtml(html);
    return { personnel };
  })();

  cache.set(key, task);
  return (await task).personnel;
}

function parseSummaryArtist(summary: string | undefined): string | null {
  if (!summary) return null;
  // crude pattern: "<Title> is a song by Artist ..."
  const match = summary.match(/song by\s+([^.]+)/i);
  if (match) {
    return match[1].trim();
  }
  return null;
}

function parseSummaryYear(summary: string | undefined): string | null {
  if (!summary) return null;
  const match = summary.match(/(19|20)\d{2}/);
  return match ? match[0] : null;
}

export async function searchWikipediaTrack(
  query: string,
): Promise<{
  id: string;
  title: string;
  artist: string;
  year: string | null;
  source: string;
}> {
  const key = query.toLowerCase().trim();
  if (searchCache.has(key)) {
    const cached = await searchCache.get(key)!;
    if (cached) return cached;
  }

  const task = (async () => {
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

    const artist =
      parseSummaryArtist(summary?.extract) ??
      (summary?.titles?.normalized ?? summary?.title ?? "Unknown artist");
    const year = parseSummaryYear(summary?.extract);

    return {
      id: `wiki:${summary?.pageid ?? first.pageid ?? first.title}`,
      title: summary?.title ?? first.title,
      artist,
      year,
      source: "wikipedia",
    };
  })();

  searchCache.set(key, task);
  const result = await task;
  return result as any;
}
