// lib/musicbrainz.ts
import { MusicBrainzApi } from "musicbrainz-api";
import type { SearchResultItem } from "./types";
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

// Helper: turn artist-credit array into a human string
export function formatArtistCredit(recording: any): string {
  const ac = recording["artist-credit"] ?? recording.artistCredit ?? [];
  if (!Array.isArray(ac)) return "";
  return ac
    .map((entry: any) => {
      if (typeof entry === "string") return entry; // join phrase
      const name = entry.name || entry.artist?.name;
      const join = entry.joinphrase ?? "";
      return `${name ?? ""}${join}`;
    })
    .join("");
}

export async function searchGlobalRecordings(
  query: string,
  totalLimit = 200
): Promise<SearchResultItem[]> {
  const mb = getMBClient();

  const recordings: any[] = [];
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

  return recordings.map((rec: any): SearchResultItem => {
    const id = rec.id ?? rec["id"] ?? rec["mbid"];
    const artist = formatArtistCredit(rec);
    const primaryRelease =
      Array.isArray(rec.releases) && rec.releases.length > 0
        ? rec.releases[0]
        : null;

    const releaseTitle = primaryRelease?.title ?? null;
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
      title: rec.title,
      artist,
      releaseTitle,
      year,
      score,
      releases: rec.releases, // Preserve releases array for filtering
    };
  });
}

export async function searchRecordingsByExactTitle(
  title: string,
  totalLimit = 200
): Promise<SearchResultItem[]> {
  const mb = getMBClient();
  const query = `recording:"${title}"`;

  const recordings: any[] = [];
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

  return recordings.map((rec: any): SearchResultItem => {
    const id = rec.id ?? rec["id"] ?? rec["mbid"];
    const artist = formatArtistCredit(rec);
    const primaryRelease =
      Array.isArray(rec.releases) && rec.releases.length > 0
        ? rec.releases[0]
        : null;

    const releaseTitle = primaryRelease?.title ?? null;
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
      title: rec.title,
      artist,
      releaseTitle,
      year,
      score,
      releases: rec.releases,
    };
  });
}

export async function searchRecordingsByExactTitleNoRepeats(
  title: string,
  totalLimit = 200
): Promise<SearchResultItem[]> {
  const mb = getMBClient();
  const query = `recording:"${title}" AND NOT recording:"${title} ${title}"`;
  const recordings: any[] = [];
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

  return recordings.map((rec: any): SearchResultItem => {
    const id = rec.id ?? rec["id"] ?? rec["mbid"];
    const artist = formatArtistCredit(rec);
    const primaryRelease =
      Array.isArray(rec.releases) && rec.releases.length > 0
        ? rec.releases[0]
        : null;

    const releaseTitle = primaryRelease?.title ?? null;
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
      title: rec.title,
      artist,
      releaseTitle,
      year,
      score,
      releases: rec.releases,
    };
  });
}

export async function lookupRecording(id: string): Promise<any> {
  const mb = getMBClient();

  const recording = await mb.lookup("recording", id, [
    "artists",
    "artist-rels",
    "recording-rels",
    "work-rels",
    "releases",
    "isrcs",
  ]);

  // Log the raw response before returning
  await logMusicBrainzResponse("lookup", recording, undefined, id);

  return recording;
}

export async function searchArtistByName(name: string) {
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
  artistId: string
) {
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
  limit = 50
) {
  const mb = getMBClient();
  const query = `recording:"${title}" AND artist:"${artistName}"`;
  const result = await mb.search("recording", { query, limit });

  await logMusicBrainzResponse("search", result, query);

  return result.recordings || [];
}
