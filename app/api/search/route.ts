import {
  isLikelyStudioVersion,
  recordingMatchesArtist,
  recordingHasUSRelease,
  isOriginalAlbumRelease,
  isNotCompilationTitle,
  isStudioReleaseTitle,
  titleMatchesQuery,
  scoreRecordingMatch,
  isRepeatedSingleWordTitle,
  isRepeatedTitleValue,
} from "@/lib/filters";

import {
  searchArtistByName,
  searchRecordingsByTitleForArtist,
  searchGlobalRecordings,
  searchRecordingsByExactTitle,
  searchRecordingsByExactTitleNoRepeats,
  searchRecordingsByTitleAndArtistName,
} from "@/lib/musicbrainz";

import { normalizeSearchRecording } from "@/lib/normalizeSearch";
import { parseUserQuery } from "@/lib/parseQuery";
import { NextResponse } from "next/server";
import { rerankSearchResults, inferLikelyArtists } from "@/lib/openai";

function cleanRecordingReleases(rec: any) {
  if (!Array.isArray(rec.releases)) return rec;

  const original = rec.releases;
  let r = original;

  const album = r.filter(isOriginalAlbumRelease);
  if (album.length > 0) r = album;

  const nonComp = r.filter(isNotCompilationTitle);
  if (nonComp.length > 0) r = nonComp;

  const studioTitles = r.filter(isStudioReleaseTitle);
  if (studioTitles.length > 0) r = studioTitles;

  // If every release looks like a remix/alt, drop the recording
  if (r.length === 0 && original.length > 0) return null;

  return { ...rec, releases: r };
}

function cleanRecording(rec: any, title: string, artist?: string | null) {
  if (artist && !recordingMatchesArtist(rec, artist)) return null;
  if (!isLikelyStudioVersion(rec)) return null;
  if (!titleMatchesQuery(rec, title)) return null;

  const cleaned = cleanRecordingReleases(rec);
  if (!cleaned) return null;

  return cleaned;
}

function rankAndNormalize(
  recordings: any[],
  userTitle: string,
  userArtist?: string | null,
  limit = 5
) {
  return recordings
    .map((rec) => ({
      rec,
      score: scoreRecordingMatch(rec, userTitle, userArtist),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ rec }) => normalizeSearchRecording(rec));
}

function logSampleTitles(label: string, recs: any[], limit = 8) {
  const titles = recs.slice(0, limit).map((r) => r.title);
  console.log(`[DEBUG][${label}] count=${recs.length} sample=`, titles);
}

function logSampleBrief(label: string, recs: any[], limit = 8) {
  const sample = recs.slice(0, limit).map((r) => {
    const artist = getArtistName(r);
    return `${r.title ?? "(no title)"} — ${artist || "(no artist)"}`;
  });
  console.log(`[DEBUG][${label}] count=${recs.length} sample=`, sample);
}

function normalizeText(val: string | null | undefined): string {
  return (val ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function keepEarliestPerTitleArtist(
  items: ReturnType<typeof normalizeSearchRecording>[]
) {
  const key = (item: any) =>
    `${normalizeText(item.title)}::${normalizeText(item.artist)}`;

  const best = new Map<
    string,
    { item: ReturnType<typeof normalizeSearchRecording>; year: number }
  >();

  items.forEach((item) => {
    const k = key(item);
    const y = parseInt(item.year ?? item.release?.date?.slice(0, 4));
    const year = isNaN(y) ? Infinity : y;

    const existing = best.get(k);
    if (!existing || year < existing.year) {
      best.set(k, { item, year });
    }
  });

  return Array.from(best.values()).map((entry) => entry.item);
}

function preferDominantArtist(
  items: ReturnType<typeof normalizeSearchRecording>[],
  minCount = 2,
  dominanceRatio = 2
) {
  if (items.length === 0) return items;

  const counts = new Map<string, { count: number; artist: string }>();

  let bestScoreItem: (typeof items)[number] | null = null;
  items.forEach((item) => {
    const key = normalizeText(item.artist);
    if (!key) return;
    const existing = counts.get(key) ?? { count: 0, artist: item.artist };
    counts.set(key, { artist: existing.artist, count: existing.count + 1 });

    if (
      bestScoreItem == null ||
      (item.score ?? 0) > (bestScoreItem.score ?? 0)
    ) {
      bestScoreItem = item;
    }
  });

  if (counts.size === 0 || !bestScoreItem) return items;

  const ranked = Array.from(counts.values()).sort((a, b) => b.count - a.count);
  const top = ranked[0];
  const next = ranked[1];

  if (!top || top.count < minCount) return items;
  const nextCount = next?.count ?? 0;

  const bestArtistKey = normalizeText(bestScoreItem.artist);
  const topKey = normalizeText(top.artist);

  // Only collapse if the dominant artist is also the best-scoring artist
  if (
    (nextCount === 0 || top.count >= dominanceRatio * nextCount) &&
    topKey === bestArtistKey
  ) {
    const filtered = items.filter(
      (item) => normalizeText(item.artist) === topKey
    );
    return filtered.length > 0 ? filtered : items;
  }

  return items;
}

function ensurePreferredArtists(
  normalized: ReturnType<typeof normalizeSearchRecording>[],
  preferred: string[],
  sourcePool: ReturnType<typeof normalizeSearchRecording>[],
  limit = 20
) {
  if (preferred.length === 0) return normalized;

  const preferredKeys = preferred.map(normalizeText).filter(Boolean);
  if (preferredKeys.length === 0) return normalized;

  const hasPreferred = normalized.some((item) =>
    preferredKeys.includes(normalizeText(item.artist))
  );
  if (hasPreferred) return normalized;

  const candidates = sourcePool.filter((item) =>
    preferredKeys.includes(normalizeText(item.artist))
  );

  const reinserts = candidates
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, preferredKeys.length);

  if (reinserts.length === 0) return normalized;

  const merged = [...reinserts, ...normalized];
  const seen = new Set<string>();
  const deduped = merged.filter((item) => {
    if (!item.id) return true;
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });

  return deduped.slice(0, limit);
}

function forcePreferred(
  normalized: ReturnType<typeof normalizeSearchRecording>[],
  preferred: string[],
  sourcePool: ReturnType<typeof normalizeSearchRecording>[],
  rawPool: ReturnType<typeof normalizeSearchRecording>[] = [],
  limit = 20
) {
  if (preferred.length === 0) return normalized;
  const preferredKeys = preferred.map(normalizeText).filter(Boolean);
  if (preferredKeys.length === 0) return normalized;

  const hasPreferred = normalized.some((item) =>
    preferredKeys.includes(normalizeText(item.artist))
  );
  if (hasPreferred) return normalized;

  const best =
    sourcePool
      .filter((item) => preferredKeys.includes(normalizeText(item.artist)))
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0] ||
    rawPool
      .filter(
        (item) =>
          preferredKeys.includes(normalizeText(item.artist)) &&
          normalizeText(item.title) === normalizeText(normalized[0]?.title)
      )
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0];

  if (!best) return normalized;

  const merged = [best, ...normalized];
  const seen = new Set<string>();
  const deduped = merged.filter((item) => {
    if (!item.id) return true;
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });

  return deduped.slice(0, limit);
}

function getArtistName(rec: any): string {
  if (rec.artist) return rec.artist;

  const ac = rec["artist-credit"];
  if (Array.isArray(ac)) {
    return ac
      .map((entry: any) => {
        if (typeof entry === "string") return entry;
        return entry?.artist?.name ?? entry?.name ?? "";
      })
      .join("")
      .trim();
  }

  return "";
}

function extractTopArtists(recs: any[], title: string, limit = 3): string[] {
  const bucket = new Map<
    string,
    { count: number; maxScore: number; artist: string }
  >();

  recs.forEach((rec) => {
    const artist = getArtistName(rec);
    if (!artist) return;

    const titleMatch =
      normalizeText(rec.title) === normalizeText(title) ||
      titleMatchesQuery(rec, title);
    if (!titleMatch) return;

    const raw =
      typeof rec.score === "number"
        ? rec.score
        : rec["ext:score"]
        ? Number(rec["ext:score"])
        : 0;

    const key = artist.toLowerCase();
    const existing = bucket.get(key) ?? { count: 0, maxScore: 0, artist };
    bucket.set(key, {
      artist,
      count: existing.count + 1,
      maxScore: Math.max(existing.maxScore, raw || 0),
    });
  });

  const ranked = Array.from(bucket.values()).sort((a, b) => {
    const scoreA = a.count * 10 + a.maxScore;
    const scoreB = b.count * 10 + b.maxScore;
    return scoreB - scoreA;
  });

  return ranked.slice(0, limit).map((r) => r.artist);
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q");
  if (!q) return NextResponse.json({ error: "Missing q" }, { status: 400 });

  const { title, artist } = parseUserQuery(q);
  const isSingleWordQuery = title.trim().split(/\s+/).length === 1;

  console.log(`[SEARCH] q="${q}" title="${title}" artist="${artist ?? ""}"`);

  // ============================================================
  // 1. SCOPED SEARCH: user supplied an artist
  // ============================================================
  if (artist) {
    const artistMatch = await searchArtistByName(artist);

    if (artistMatch) {
      const scoped = await searchRecordingsByTitleForArtist(
        title,
        artistMatch.id
      );
      logSampleTitles("SCOPED raw", scoped);
      logSampleBrief("SCOPED raw brief", scoped);

      let filtered = scoped
        .map((rec) => cleanRecording(rec, title, artistMatch.name))
        .filter(Boolean) as any[];

      logSampleTitles("SCOPED filtered", filtered);

      // Prefer US releases
      const usOnly = filtered.filter(recordingHasUSRelease);
      if (usOnly.length > 0) filtered = usOnly;

      console.log(`[SCOPED] After cleanup: ${filtered.length}`);

      if (filtered.length > 0) {
        const normalized = rankAndNormalize(
          filtered,
          title,
          artistMatch.name,
          5
        );

        return NextResponse.json({ results: normalized });
      }

      if (scoped.length > 0) {
        console.log(
          `[SCOPED] All filtered out — returning original scoped results`
        );

        const normalized = rankAndNormalize(
          scoped,
          title,
          artistMatch.name,
          5
        );

        return NextResponse.json({ results: normalized });
      }

      // If artistMatch exists but no scoped results, fall through to GLOBAL
      console.log(`[SCOPED] No scoped results — falling back to GLOBAL`);
    }
  }

  // ============================================================
  // 2. GLOBAL SEARCH (title only)
  // ============================================================
  const global = await searchGlobalRecordings(title);
  logSampleTitles("GLOBAL raw", global);
  logSampleBrief("GLOBAL raw brief", global);

  const rawGlobalNormalized = global.map((rec) =>
    normalizeSearchRecording({
      ...rec,
      artist: getArtistName(rec),
    })
  );

  let preferredArtists: string[] = [];
  let preferredPool: ReturnType<typeof normalizeSearchRecording>[] = [];

  let filtered = global
    .map((rec) => cleanRecording(rec, title))
    .filter(Boolean) as any[];

  logSampleTitles("GLOBAL filtered", filtered);

  const usOnly = filtered.filter(recordingHasUSRelease);
  if (usOnly.length > 0) filtered = usOnly;

  if (filtered.length === 0) {
    console.log(
      `[GLOBAL] Filters removed everything — falling back to unfiltered global results`
    );
    const titleOnly = global
      .map((rec) => cleanRecording(rec, title))
      .filter(Boolean) as any[];
    filtered = titleOnly.length > 0 ? titleOnly : global;
    logSampleTitles("GLOBAL fallback", filtered);
  }

  let pool = filtered;

  if (isSingleWordQuery) {
    const exactTitle = pool.filter(
      (rec) =>
        normalizeText(rec.title) === normalizeText(title) &&
        !isRepeatedSingleWordTitle(rec, title)
    );

    if (exactTitle.length > 0) {
      logSampleTitles("GLOBAL exact-title narrowed", exactTitle);
      pool = exactTitle;
    } else {
      const nonRepeats = pool.filter(
        (rec) => !isRepeatedSingleWordTitle(rec, title)
      );
      if (nonRepeats.length > 0) {
        logSampleTitles("GLOBAL non-repeats narrowed", nonRepeats);
        pool = nonRepeats;
      }
    }
  }

  let normalized = rankAndNormalize(pool, title, null, 5);
  preferredPool = preferredPool.concat(normalized);

  // If everything got filtered, fall back to a minimal title-only ranking
  if (normalized.length === 0) {
    console.log(
      `[GLOBAL] Normalized list empty after repeated-title filter — falling back to title-only ranking`
    );
    const titleOnly = global.filter((rec) => titleMatchesQuery(rec, title));
    const pool =
      titleOnly.length > 0 ? titleOnly : global;

    normalized = rankAndNormalize(pool, title, null, 5);
  }

  // If we still have no strong exact-title match, run exact-title queries and merge
  const hasExact =
    normalized.some((n) => normalizeText(n.title) === normalizeText(title)) ||
    false;

  let exactResults: any[] = [];
  let exactNoRepeatResults: any[] = [];

  if (!hasExact) {
    const [exact, exactNoRepeats] = await Promise.all([
      searchRecordingsByExactTitle(title, 50),
      searchRecordingsByExactTitleNoRepeats(title, 200),
    ]);
    logSampleTitles("GLOBAL exact-title raw", exact);
    logSampleTitles("GLOBAL exact-title no-repeats raw", exactNoRepeats);
    logSampleBrief("GLOBAL exact-title raw brief", exact);
    logSampleBrief("GLOBAL exact-title no-repeats raw brief", exactNoRepeats);

    exactResults = exact
      .map((rec) => cleanRecording(rec, title))
      .filter(Boolean) as any[];
    exactNoRepeatResults = exactNoRepeats
      .map((rec) => cleanRecording(rec, title))
      .filter(Boolean) as any[];

    const exactNormalized = rankAndNormalize(
      exactResults,
      title,
      null,
      10
    ).filter((rec) => !isRepeatedSingleWordTitle(rec, title));
    const noRepeatNormalized = rankAndNormalize(
      exactNoRepeatResults,
      title,
      null,
      10
    );
    const merged = [...normalized, ...exactNormalized, ...noRepeatNormalized];
    preferredPool = preferredPool.concat(
      exactNormalized,
      noRepeatNormalized,
      merged
    );

    const seen = new Set<string>();
    normalized = merged.filter((item) => {
      if (!item.id) return true;
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });
  }

  // Dynamic artist+title fallback when no artist is provided: try the most common artists from results
  if (!artist) {
    const candidates = [
      ...exactResults,
      ...exactNoRepeatResults,
      ...global,
    ];
    const topArtists = extractTopArtists(candidates, title, 3);
    preferredArtists = Array.from(new Set([...preferredArtists, ...topArtists]));

    if (topArtists.length > 0) {
      const targeted = await Promise.all(
        topArtists.map((a) =>
          searchRecordingsByTitleAndArtistName(title, a)
        )
      );

      targeted.forEach((list, idx) => {
        logSampleTitles(
          `GLOBAL artist-title dynamic raw [${topArtists[idx]}]`,
          list
        );
        logSampleBrief(
          `GLOBAL artist-title dynamic raw brief [${topArtists[idx]}]`,
          list
        );
      });

      const targetedNormalized = targeted
        .flat()
        .map((rec) => cleanRecording(rec, title))
        .filter(Boolean)
        .map((rec: any) =>
          normalizeSearchRecording({
            ...rec,
            artist: getArtistName(rec),
          })
        );
      preferredPool = preferredPool.concat(targetedNormalized);

      const merged = [...targetedNormalized, ...normalized];
      const seen = new Set<string>();
      normalized = merged.filter((item) => {
        if (!item.id) return true;
        if (seen.has(item.id)) return false;
        seen.add(item.id);
        return true;
      });
    }

    // LLM-inferred artists
    const inferred = await inferLikelyArtists(title, 3);
    if (inferred.length > 0) {
      preferredArtists = Array.from(new Set([...preferredArtists, ...inferred]));
      const targeted = await Promise.all(
        inferred.map((a) => searchRecordingsByTitleAndArtistName(title, a))
      );

      targeted.forEach((list, idx) => {
        logSampleTitles(
          `GLOBAL artist-title inferred raw [${inferred[idx]}]`,
          list
        );
        logSampleBrief(
          `GLOBAL artist-title inferred raw brief [${inferred[idx]}]`,
          list
        );
      });

      const targetedNormalized = targeted
        .flat()
        .map((rec) => cleanRecording(rec, title))
        .filter(Boolean)
        .map((rec: any) =>
          normalizeSearchRecording({
            ...rec,
            artist: getArtistName(rec),
          })
        );
      preferredPool = preferredPool.concat(targetedNormalized);

      const merged = [...targetedNormalized, ...normalized];
      const seen = new Set<string>();
      normalized = merged.filter((item) => {
        if (!item.id) return true;
        if (seen.has(item.id)) return false;
        seen.add(item.id);
        return true;
      });
    }
  }

  // Extra popular-artist fallback (covers cases like "hello" => Adele)
  // Collapse to earliest release per title+artist to avoid reissues dominating
  normalized = keepEarliestPerTitleArtist(normalized);

  // Keep a pre-dominance copy so we can reinsert preferred artists later
  const beforeDominant = normalized.slice();

  // If one artist clearly dominates the matches, collapse to that artist (covers/alt artists drop)
  if (!artist) {
    const before = normalized.length;
    normalized = preferDominantArtist(normalized);
    if (normalized.length !== before) {
      logSampleTitles("GLOBAL dominant-artist collapse", normalized);
      logSampleBrief("GLOBAL dominant-artist collapse brief", normalized);
    }
  }

  // Ensure preferred artists (e.g., Nirvana) are still present before rerank
  normalized = ensurePreferredArtists(normalized, preferredArtists, preferredPool);
  normalized = forcePreferred(normalized, preferredArtists, preferredPool, rawGlobalNormalized);

  // For single-word queries, prefer non-repeated titles in the final list
  if (isSingleWordQuery) {
    const target = normalizeText(title);

    const exactMatches = normalized.filter(
      (item) => normalizeText(item.title) === target
    );
    if (exactMatches.length > 0) {
      normalized = exactMatches;
      logSampleTitles("GLOBAL single-word exact-only", normalized);
    }
  }

  // LLM rerank to boost the most obvious matches
  try {
    const preRerank = normalized.slice();
    const before = normalized.slice(0, 40);
    const reranked = await rerankSearchResults(before, q);
    if (reranked && reranked.length) {
      const seen = new Set<string>();
      normalized = reranked
        .concat(normalized)
        .filter((item) => {
          if (!item.id) return true;
          if (seen.has(item.id)) return false;
          seen.add(item.id);
          return true;
        })
        .slice(0, 20);
      logSampleTitles("GLOBAL reranked", normalized);
      logSampleBrief("GLOBAL reranked brief", normalized);

      // If rerank loses all preferred artists (e.g., Nirvana for "smells like teen spirit"), reinsert them
      normalized = ensurePreferredArtists(
        normalized,
        preferredArtists,
        preferredPool.length ? preferredPool : preRerank.length ? preRerank : beforeDominant
      );
      normalized = forcePreferred(
        normalized,
        preferredArtists,
        preferredPool.length ? preferredPool : preRerank.length ? preRerank : beforeDominant,
        rawGlobalNormalized
      );
      logSampleTitles("GLOBAL reranked with preferred", normalized);
      logSampleBrief("GLOBAL reranked with preferred brief", normalized);
    }
  } catch (err) {
    console.error("Rerank failed", err);
  }

  logSampleTitles("GLOBAL normalized", normalized);

  return NextResponse.json({ results: normalized });
}
