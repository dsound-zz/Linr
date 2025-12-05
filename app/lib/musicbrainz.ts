// lib/musicbrainz.ts
import { MusicBrainzApi } from "musicbrainz-api";
import type { SearchResultItem } from "./types";

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
function formatArtistCredit(recording: any): string {
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

export async function searchRecordingsByTitle(
  query: string,
  limit = 10
): Promise<SearchResultItem[]> {
  const mb = getMBClient();

  // @musicbrainz/api returns an object with `recordings`
  const result = await mb.search("recording", { query, limit });

  const recordings: any[] = result.recordings ?? [];

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

  return recording;
}
