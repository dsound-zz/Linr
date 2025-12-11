import { formatArtistCredit } from "./musicbrainz";
import type { MusicBrainzRecording, SearchResultItem } from "./types";

export function normalizeSearchRecording(
  rec: MusicBrainzRecording | SearchResultItem,
) {
  const id = rec.id;

  // Handle both raw recordings (with artist-credit) and SearchResultItem (with artist string)
  const artist =
    rec.artist ||
    ("artist-credit" in rec || "artistCredit" in rec
      ? formatArtistCredit(rec as MusicBrainzRecording)
      : "");

  // Get release info (MB returns many versions: studio, live, compilations)
  const primaryRelease =
    Array.isArray(rec.releases) && rec.releases.length > 0
      ? rec.releases[0]
      : null;

  // Year
  const date =
    primaryRelease?.date ??
    ("first-release-date" in rec ? rec["first-release-date"] : null) ??
    null;

  const year = date ? date.slice(0, 4) : null;

  // Score (MB returns 100 or ext:score weirdly)
  const score =
    typeof rec.score === "number"
      ? rec.score
      : rec.score === null
        ? null
        : "ext:score" in rec && rec["ext:score"]
          ? Number(rec["ext:score"])
          : null;

  const source =
    "source" in rec &&
    typeof (rec as Record<string, unknown>).source === "string"
      ? ((rec as Record<string, unknown>).source as string)
      : undefined;

  return {
    id,
    title: rec.title ?? null,
    artist,
    year,
    durationMs:
      "length" in rec
        ? (rec.length ?? null)
        : "durationMs" in rec
          ? (rec.durationMs ?? null)
          : null,
    score,
    source,
  };
}
