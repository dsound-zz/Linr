import {
  isLikelyStudioVersion,
  recordingMatchesArtist,
  recordingHasUSRelease,
  isOriginalAlbumRelease,
  isNotCompilationTitle,
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
        .filter((rec) => recordingMatchesArtist(rec, artistMatch.name))
        .filter(isLikelyStudioVersion)
        .filter((rec) => titleMatchesQuery(rec, title));

      logSampleTitles("SCOPED filtered", filtered);

      // Prefer US releases
      const usOnly = filtered.filter(recordingHasUSRelease);
      if (usOnly.length > 0) filtered = usOnly;

      // Per-recording release filtering
      filtered = filtered.map((rec) => {
        if (!Array.isArray(rec.releases)) return rec;

        let r = rec.releases;

        // Prefer album releases
        const album = r.filter(isOriginalAlbumRelease);
        if (album.length > 0) r = album;

        // Remove compilations
        const nonComp = r.filter(isNotCompilationTitle);
        if (nonComp.length > 0) r = nonComp;

        // If we filtered everything out, keep original releases so we don't lose the recording
        if (r.length === 0) return rec;

        return { ...rec, releases: r };
      });

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

  let filtered = global
    .filter(isLikelyStudioVersion)
    .filter((rec) => titleMatchesQuery(rec, title));

  logSampleTitles("GLOBAL filtered", filtered);

  const usOnly = filtered.filter(recordingHasUSRelease);
  if (usOnly.length > 0) filtered = usOnly;

  // Per-recording release cleanup
  filtered = filtered.map((rec) => {
    if (!Array.isArray(rec.releases)) return rec;

    let r = rec.releases;

    const album = r.filter(isOriginalAlbumRelease);
    if (album.length > 0) r = album;

    const nonComp = r.filter(isNotCompilationTitle);
    if (nonComp.length > 0) r = nonComp;

    // If we filtered everything out, keep original releases so we don't lose the recording
    if (r.length === 0) return rec;

    return { ...rec, releases: r };
  });

  if (filtered.length === 0) {
    console.log(
      `[GLOBAL] Filters removed everything — falling back to unfiltered global results`
    );
    const titleOnly = global
      .filter((rec) => titleMatchesQuery(rec, title));
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

    exactResults = exact;
    exactNoRepeatResults = exactNoRepeats;

    const exactNormalized = rankAndNormalize(exact, title, null, 10).filter(
      (rec) => !isRepeatedSingleWordTitle(rec, title)
    );
    const noRepeatNormalized = rankAndNormalize(
      exactNoRepeats,
      title,
      null,
      10
    );
    const merged = [...normalized, ...exactNormalized, ...noRepeatNormalized];

    const seen = new Set<string>();
    normalized = merged.filter((item) => {
      if (!item.id) return true;
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });
  }

  // Dynamic artist+title fallback for single-word queries: try top artists from exact results
  if (isSingleWordQuery && !artist) {
    const candidates = [
      ...exactResults,
      ...exactNoRepeatResults,
      ...global,
    ];
    const topArtists = extractTopArtists(candidates, title, 3);

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
        .map((rec) =>
          normalizeSearchRecording({
            ...rec,
            artist: getArtistName(rec),
          })
        );

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
        .map((rec) =>
          normalizeSearchRecording({
            ...rec,
            artist: getArtistName(rec),
          })
        );

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
    }
  } catch (err) {
    console.error("Rerank failed", err);
  }

  logSampleTitles("GLOBAL normalized", normalized);

  return NextResponse.json({ results: normalized });
}
