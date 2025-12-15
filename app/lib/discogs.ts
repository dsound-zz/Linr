/**
 * discogs.ts
 *
 * Optional Discogs enrichment for credits.
 *
 * Requires: DISCOGS_TOKEN
 * https://www.discogs.com/developers/
 *
 * We only use Discogs to *add* credits when MusicBrainz/Wikipedia are sparse.
 */

import { cacheKeyRecording, getCached, setCached } from "./search/cache";

const DISCOGS_TOKEN = process.env.DISCOGS_TOKEN;

type DiscogsSearchResponse = {
  results?: Array<{
    id?: number;
    type?: string;
    title?: string;
    year?: number;
    country?: string;
  }>;
};

type DiscogsReleaseResponse = {
  id?: number;
  title?: string;
  year?: number;
  artists?: Array<{ name?: string }>;
  extraartists?: Array<{ name?: string; role?: string }>;
};

function discogsHeaders() {
  return {
    "User-Agent": "linr/0.1.0 +https://github.com/",
    Accept: "application/json",
  };
}

function normalizeRoleLoose(role: string): string {
  return (role ?? "")
    .toLowerCase()
    .trim()
    .replace(/[\[\]\(\)]/g, " ")
    .replace(/[-–—_/\\,;:]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function roleCategoryScore(role: string): {
  musician: number;
  production: number;
  writing: number;
} {
  const r = normalizeRoleLoose(role);
  if (!r) return { musician: 0, production: 0, writing: 0 };

  // Musician / performance-ish roles (what users expect in Performers)
  const musicianKeywords = [
    "vocals",
    "vocal",
    "singer",
    "guitar",
    "bass",
    "drums",
    "percussion",
    "keyboards",
    "keyboard",
    "piano",
    "synth",
    "synthesizer",
    "organ",
    "horn",
    "sax",
    "saxophone",
    "trumpet",
    "trombone",
    "violin",
    "strings",
    "cello",
    "backing",
    "choir",
    "congas",
    "timbales",
    "marimba",
    "harmonica",
  ];
  if (musicianKeywords.some((k) => r.includes(k))) {
    return { musician: 1, production: 0, writing: 0 };
  }

  // Writing roles
  if (
    r.includes("written") ||
    r.includes("write") ||
    r.includes("songwriter") ||
    r.includes("composer") ||
    r.includes("composition") ||
    r.includes("lyrics") ||
    r.includes("lyric")
  ) {
    return { musician: 0, production: 0, writing: 1 };
  }

  // Production roles
  if (
    r.includes("producer") ||
    r.includes("engineer") ||
    r.includes("recorded") ||
    r.includes("recording") ||
    r.includes("mix") ||
    r.includes("master")
  ) {
    return { musician: 0, production: 1, writing: 0 };
  }

  return { musician: 0, production: 0, writing: 0 };
}

function normalizeLoose(s: string): string {
  return (s ?? "")
    .replace(/’/g, "'")
    .toLowerCase()
    .replace(/[^a-z0-9\s']/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function fetchDiscogsCredits(params: {
  artist: string;
  title: string;
  releaseTitle?: string | null;
}): Promise<Array<{ name: string; role: string }>> {
  if (!DISCOGS_TOKEN) return [];

  const { artist, title, releaseTitle } = params;
  const key = cacheKeyRecording(
    `discogs:credits:${normalizeLoose(artist)}:${normalizeLoose(releaseTitle ?? title)}`,
  );
  const cached = await getCached<Array<{ name: string; role: string }>>(key);
  if (cached) return cached;

  try {
    const qArtist = artist.trim();
    const qReleaseTitle = (releaseTitle ?? title).trim();
    if (!qArtist || !qReleaseTitle) return [];

    // Discogs often has multiple release entries: some are bare, some have full
    // `extraartists`. We search and then pick the candidate with the most credits.
    const searchAttempts: Array<{ url: URL }> = [];

    // Attempt 1: treat releaseTitle as album/single title (best for album-level personnel)
    {
      const u = new URL("https://api.discogs.com/database/search");
      u.searchParams.set("type", "release");
      u.searchParams.set("artist", qArtist);
      u.searchParams.set("release_title", qReleaseTitle);
      u.searchParams.set("per_page", "12");
      u.searchParams.set("token", DISCOGS_TOKEN);
      searchAttempts.push({ url: u });
    }

    // Attempt 2: search by track name (helps when the album title differs)
    {
      const u = new URL("https://api.discogs.com/database/search");
      u.searchParams.set("type", "release");
      u.searchParams.set("artist", qArtist);
      u.searchParams.set("track", title.trim());
      // Track searches can return lots of remixes/covers; pull a bit more and we’ll
      // filter down + pick the best by musician-role density.
      u.searchParams.set("per_page", "20");
      u.searchParams.set("token", DISCOGS_TOKEN);
      searchAttempts.push({ url: u });
    }

    const candidateIds: number[] = [];
    for (const attempt of searchAttempts) {
      const sRes = await fetch(attempt.url.toString(), {
        headers: discogsHeaders(),
      });
      if (!sRes.ok) continue;
      const sJson = (await sRes.json()) as DiscogsSearchResponse;
      const results = Array.isArray(sJson.results) ? sJson.results : [];
      for (const r of results) {
        if (r?.type !== "release" || typeof r.id !== "number") continue;
        // Discogs search results often have `title` like "Artist - Release".
        // Filter out obvious mismatches where the artist isn't even present.
        const t = (r.title ?? "").toLowerCase();
        if (t && !t.includes(qArtist.toLowerCase())) continue;
        candidateIds.push(r.id);
      }
      if (candidateIds.length >= 12) break;
    }

    const uniqIds = Array.from(new Set(candidateIds)).slice(0, 8);
    if (uniqIds.length === 0) return [];

    let best: {
      id: number;
      credits: Array<{ name: string; role: string }>;
      score: number;
    } | null = null;

    for (const relId of uniqIds) {
      const relUrl = `https://api.discogs.com/releases/${relId}?token=${encodeURIComponent(
        DISCOGS_TOKEN,
      )}`;
      const rRes = await fetch(relUrl, { headers: discogsHeaders() });
      if (!rRes.ok) continue;
      const rJson = (await rRes.json()) as DiscogsReleaseResponse;
      const extra = Array.isArray(rJson.extraartists) ? rJson.extraartists : [];

      const credits: Array<{ name: string; role: string }> = [];
      let musicianCount = 0;
      let productionCount = 0;
      let writingCount = 0;
      for (const ea of extra) {
        const name = (ea?.name ?? "").trim();
        const role = (ea?.role ?? "").trim();
        if (!name || !role) continue;

        // Discogs roles can be "Bass, Backing Vocals" etc; keep as-is and let UI parse.
        const roles = role
          .split(/;|\/|,/)
          .map((r) => r.trim())
          .filter(Boolean);
        for (const r of roles) {
          credits.push({ name, role: r });
          const c = roleCategoryScore(r);
          musicianCount += c.musician;
          productionCount += c.production;
          writingCount += c.writing;
        }
      }

      // Prefer releases that actually contain musician/instrument roles.
      // Writing/production-only releases are common and don't help Performers.
      const score =
        musicianCount * 10 +
        productionCount * 2 +
        writingCount +
        Math.min(10, credits.length / 5);
      if (!best || score > best.score) {
        best = { id: relId, credits, score };
      }
    }

    if (!best || best.credits.length === 0) return [];

    // Best-effort cache (short TTL via shared cache layer)
    void setCached(key, best.credits);
    return best.credits;
  } catch {
    return [];
  }
}

export async function fetchDiscogsCreditsDebug(params: {
  artist: string;
  title: string;
  releaseTitle?: string | null;
}): Promise<{
  credits: Array<{ name: string; role: string }>;
  meta: {
    tokenPresent: boolean;
    searchUrl: string;
    searchStatus: number | null;
    searchMessage?: string;
    firstResult?: {
      id: number;
      title?: string;
      year?: number;
      country?: string;
    };
    candidateReleaseIds?: number[];
    chosenReleaseId?: number;
    releaseStatus: number | null;
    extraartistsCount: number | null;
  };
}> {
  const { artist, title, releaseTitle } = params;
  const qArtist = artist.trim();
  const qReleaseTitle = (releaseTitle ?? title).trim();

  const baseSearchUrl = new URL("https://api.discogs.com/database/search");
  baseSearchUrl.searchParams.set("type", "release");
  baseSearchUrl.searchParams.set("artist", qArtist);
  baseSearchUrl.searchParams.set("release_title", qReleaseTitle);
  baseSearchUrl.searchParams.set("per_page", "5");

  const meta = {
    tokenPresent: Boolean(DISCOGS_TOKEN),
    searchUrl: baseSearchUrl.toString(), // no token included
    searchStatus: null as number | null,
    searchMessage: undefined as string | undefined,
    firstResult: undefined as
      | { id: number; title?: string; year?: number; country?: string }
      | undefined,
    candidateReleaseIds: undefined as number[] | undefined,
    chosenReleaseId: undefined as number | undefined,
    releaseStatus: null as number | null,
    extraartistsCount: null as number | null,
  };

  if (!DISCOGS_TOKEN) {
    return { credits: [], meta };
  }
  if (!qArtist || !qReleaseTitle) {
    return { credits: [], meta };
  }

  try {
    const searchUrl = new URL(baseSearchUrl.toString());
    searchUrl.searchParams.set("token", DISCOGS_TOKEN);
    const sRes = await fetch(searchUrl.toString(), {
      headers: discogsHeaders(),
    });
    meta.searchStatus = sRes.status;
    const sJson = (await sRes.json().catch(() => null)) as
      | DiscogsSearchResponse
      | { message?: string }
      | null;
    if (sJson && typeof sJson === "object" && "message" in sJson) {
      meta.searchMessage = String(
        (sJson as { message?: string }).message ?? "",
      );
    }
    if (!sRes.ok) return { credits: [], meta };

    const results =
      sJson && typeof sJson === "object" && "results" in sJson
        ? Array.isArray((sJson as DiscogsSearchResponse).results)
          ? ((sJson as DiscogsSearchResponse).results ?? [])
          : []
        : [];
    const first = results.find(
      (r) => r.type === "release" && typeof r.id === "number",
    );
    if (!first?.id) return { credits: [], meta };
    meta.firstResult = {
      id: first.id,
      title: first.title,
      year: first.year,
      country: first.country,
    };

    // Collect candidate releases from both release-title and track searches.
    const candidateIds: number[] = [];
    for (const r of results) {
      if (r?.type === "release" && typeof r.id === "number")
        candidateIds.push(r.id);
    }

    const trackUrl = new URL("https://api.discogs.com/database/search");
    trackUrl.searchParams.set("type", "release");
    trackUrl.searchParams.set("artist", qArtist);
    trackUrl.searchParams.set("track", title.trim());
    trackUrl.searchParams.set("per_page", "5");
    trackUrl.searchParams.set("token", DISCOGS_TOKEN);
    const tRes = await fetch(trackUrl.toString(), {
      headers: discogsHeaders(),
    });
    if (tRes.ok) {
      const tJson = (await tRes.json()) as DiscogsSearchResponse;
      const tResults = Array.isArray(tJson.results) ? tJson.results : [];
      for (const r of tResults) {
        if (r?.type === "release" && typeof r.id === "number")
          candidateIds.push(r.id);
      }
    }

    const uniqIds = Array.from(new Set(candidateIds)).slice(0, 8);
    meta.candidateReleaseIds = uniqIds;
    if (uniqIds.length === 0) return { credits: [], meta };

    let best: {
      id: number;
      credits: Array<{ name: string; role: string }>;
    } | null = null;
    for (const relId of uniqIds) {
      const relUrl = `https://api.discogs.com/releases/${relId}?token=${encodeURIComponent(
        DISCOGS_TOKEN,
      )}`;
      const rRes = await fetch(relUrl, { headers: discogsHeaders() });
      meta.releaseStatus = rRes.status;
      if (!rRes.ok) continue;
      const rJson = (await rRes.json()) as DiscogsReleaseResponse;
      const extra = Array.isArray(rJson.extraartists) ? rJson.extraartists : [];

      const credits: Array<{ name: string; role: string }> = [];
      for (const ea of extra) {
        const name = (ea?.name ?? "").trim();
        const role = (ea?.role ?? "").trim();
        if (!name || !role) continue;
        const roles = role
          .split(/;|\/|,/)
          .map((r) => r.trim())
          .filter(Boolean);
        for (const r of roles) credits.push({ name, role: r });
      }

      if (!best || credits.length > best.credits.length) {
        best = { id: relId, credits };
      }
    }

    if (!best) return { credits: [], meta };
    meta.chosenReleaseId = best.id;
    meta.extraartistsCount = best.credits.length;
    return { credits: best.credits, meta };
  } catch (err) {
    meta.searchMessage = err instanceof Error ? err.message : String(err);
    return { credits: [], meta };
  }
}
