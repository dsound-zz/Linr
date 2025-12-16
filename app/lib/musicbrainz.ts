// lib/musicbrainz.ts
import { MusicBrainzApi } from "musicbrainz-api";
import type {
  SearchResultItem,
  MusicBrainzRecording,
  MusicBrainzArtistCreditEntry,
  MusicBrainzArtist,
  MusicBrainzRelease,
} from "./types";
import { logMusicBrainzResponse } from "./logger";

let cachedClient: MusicBrainzApi | null = null;

export function getMBClient(): MusicBrainzApi {
  if (cachedClient) return cachedClient;

  cachedClient = new MusicBrainzApi({
    appName: "Linr",
    appVersion: "0.1.0",
    appContactInfo: "you@example.com", // put a real address
  });

  return cachedClient;
}

/**
 * Decode HTML entities in a string
 */
function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&#160;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_match, dec) => String.fromCharCode(dec));
}

// Helper: turn artist-credit array into a human string
export function formatArtistCredit(recording: MusicBrainzRecording): string {
  const ac = recording["artist-credit"] ?? recording.artistCredit ?? [];
  if (!Array.isArray(ac)) return "";
  const formatted = ac
    .map((entry: MusicBrainzArtistCreditEntry | string) => {
      if (typeof entry === "string") return entry; // join phrase
      const name = entry.name || entry.artist?.name;
      const join = entry.joinphrase ?? "";
      return `${name ?? ""}${join}`;
    })
    .join("");
  return decodeHtmlEntities(formatted);
}

export async function searchGlobalRecordings(
  query: string,
  totalLimit = 75,
): Promise<SearchResultItem[]> {
  const mb = getMBClient();

  const recordings: MusicBrainzRecording[] = [];
  const pageSize = 25; // MB search max
  for (
    let offset = 0;
    offset < totalLimit && recordings.length < totalLimit;
    offset += pageSize
  ) {
    const result = await mb.search("recording", {
      query,
      limit: pageSize,
      offset,
    });

    // Log only the first page to keep logs smaller
    if (offset === 0) {
      await logMusicBrainzResponse("search", result, query);
    }

    recordings.push(...(result.recordings ?? []));

    if (!result.recordings || result.recordings.length < pageSize) break;
  }

  return recordings.map((rec: MusicBrainzRecording): SearchResultItem => {
    const id = rec.id ?? rec["id"] ?? rec["mbid"] ?? "";
    const artist = formatArtistCredit(rec);
    const primaryRelease =
      Array.isArray(rec.releases) && rec.releases.length > 0
        ? rec.releases[0]
        : null;

    const date: string | null = primaryRelease?.date ?? null;
    const year = date ? date.slice(0, 4) : null;

    const score =
      typeof rec.score === "number"
        ? rec.score
        : rec["ext:score"]
          ? Number(rec["ext:score"])
          : null;

    return {
      id,
      title: rec.title ?? "",
      artist,
      year,
      score,
      durationMs: rec.length ?? null,
      releases: rec.releases, // Preserve releases array for filtering
    };
  });
}

export async function searchRecordingsByExactTitle(
  title: string,
  totalLimit = 75,
): Promise<SearchResultItem[]> {
  const mb = getMBClient();
  const query = `recording:"${title}"`;

  const recordings: MusicBrainzRecording[] = [];
  const pageSize = 25;
  for (
    let offset = 0;
    offset < totalLimit && recordings.length < totalLimit;
    offset += pageSize
  ) {
    const result = await mb.search("recording", {
      query,
      limit: pageSize,
      offset,
    });

    if (offset === 0) {
      await logMusicBrainzResponse("search", result, query);
    }

    recordings.push(...(result.recordings ?? []));

    if (!result.recordings || result.recordings.length < pageSize) break;
  }

  return recordings.map((rec: MusicBrainzRecording): SearchResultItem => {
    const id = rec.id ?? rec["id"] ?? rec["mbid"] ?? "";
    const artist = formatArtistCredit(rec);
    const primaryRelease =
      Array.isArray(rec.releases) && rec.releases.length > 0
        ? rec.releases[0]
        : null;

    const date: string | null = primaryRelease?.date ?? null;
    const year = date ? date.slice(0, 4) : null;

    const score =
      typeof rec.score === "number"
        ? rec.score
        : rec["ext:score"]
          ? Number(rec["ext:score"])
          : null;

    return {
      id,
      title: rec.title ?? "",
      artist,
      year,
      score,
      durationMs: rec.length ?? null,
      releases: rec.releases,
    };
  });
}

export async function searchRecordingsByExactTitleNoRepeats(
  title: string,
  totalLimit = 200,
): Promise<SearchResultItem[]> {
  const mb = getMBClient();
  const query = `recording:"${title}" AND NOT recording:"${title} ${title}"`;
  const recordings: MusicBrainzRecording[] = [];
  const pageSize = 25;
  for (
    let offset = 0;
    offset < totalLimit && recordings.length < totalLimit;
    offset += pageSize
  ) {
    const result = await mb.search("recording", {
      query,
      limit: pageSize,
      offset,
    });

    if (offset === 0) {
      await logMusicBrainzResponse("search", result, query);
    }

    recordings.push(...(result.recordings ?? []));

    if (!result.recordings || result.recordings.length < pageSize) break;
  }

  return recordings.map((rec: MusicBrainzRecording): SearchResultItem => {
    const id = rec.id ?? rec["id"] ?? rec["mbid"] ?? "";
    const artist = formatArtistCredit(rec);
    const primaryRelease =
      Array.isArray(rec.releases) && rec.releases.length > 0
        ? rec.releases[0]
        : null;

    const date: string | null = primaryRelease?.date ?? null;
    const year = date ? date.slice(0, 4) : null;

    const score =
      typeof rec.score === "number"
        ? rec.score
        : rec["ext:score"]
          ? Number(rec["ext:score"])
          : null;

    return {
      id,
      title: rec.title ?? "",
      artist,
      year,
      score,
      durationMs: rec.length ?? null,
      releases: rec.releases,
    };
  });
}

export async function lookupRecording(
  id: string,
): Promise<MusicBrainzRecording> {
  const mb = getMBClient();

  const lookup = mb.lookup as unknown as (
    this: unknown,
    entity: string,
    mbid: string,
    inc: string[],
  ) => Promise<unknown>;

  const recording = (await lookup.call(mb, "recording", id, [
    "artists",
    "artist-rels",
    "recording-rels",
    "work-rels",
    "work-level-rels",
    "releases",
    "isrcs",
    "place-rels",
  ])) as MusicBrainzRecording;

  // Log the raw response before returning
  await logMusicBrainzResponse("lookup", recording, undefined, id);

  return recording;
}

export async function lookupRelease(id: string): Promise<MusicBrainzRelease> {
  const mb = getMBClient();

  const lookup = mb.lookup as unknown as (
    this: unknown,
    entity: string,
    mbid: string,
    inc: string[],
  ) => Promise<unknown>;

  const release = (await lookup.call(mb, "release", id, [
    "artist-rels",
    "recording-rels",
    "label-rels",
    "place-rels",
    "url-rels",
    "work-rels",
    "work-level-rels",
  ])) as MusicBrainzRelease;

  await logMusicBrainzResponse(
    "lookup",
    release as unknown as MusicBrainzRecording,
    undefined,
    id,
  );

  return release;
}

export async function lookupReleaseGroup(id: string): Promise<unknown> {
  const mb = getMBClient();

  const lookup = mb.lookup as unknown as (
    this: unknown,
    entity: string,
    mbid: string,
    inc: string[],
  ) => Promise<unknown>;

  const releaseGroup = await lookup.call(mb, "release-group", id, [
    "artist-rels",
    "url-rels",
    "place-rels",
  ]);

  await logMusicBrainzResponse(
    "lookup",
    releaseGroup as unknown as MusicBrainzRecording,
    undefined,
    id,
  );

  return releaseGroup;
}

export async function searchArtistByName(
  name: string,
): Promise<MusicBrainzArtist | null> {
  const mb = getMBClient();

  const result = await mb.search("artist", { query: name, limit: 5 });

  // Log the raw response before processing
  await logMusicBrainzResponse("search", result, name);

  const artists = result.artists || [];

  if (artists.length === 0) return null;

  // pick the highest score
  return artists[0];
}

export async function searchRecordingsByTitleForArtist(
  title: string,
  artistId: string,
): Promise<MusicBrainzRecording[]> {
  const mb = getMBClient();

  const query = `${title} AND arid:${artistId}`;
  const result = await mb.search("recording", { query, limit: 25 });

  // Log the raw response before processing
  await logMusicBrainzResponse("search", result, query);

  return result.recordings || [];
}

export async function searchRecordingsByTitleAndArtistName(
  title: string,
  artistName: string,
  limit = 50,
): Promise<MusicBrainzRecording[]> {
  const mb = getMBClient();
  const query = `recording:"${title}" AND artist:"${artistName}"`;
  const result = await mb.search("recording", { query, limit });

  await logMusicBrainzResponse("search", result, query);

  return result.recordings || [];
}
