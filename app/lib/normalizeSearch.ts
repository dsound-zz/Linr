import { formatArtistCredit } from "./musicbrainz";

export function normalizeSearchRecording(rec: any) {
  const id = rec.id;

  // Handle both raw recordings (with artist-credit) and SearchResultItem (with artist string)
  const artist = rec.artist || formatArtistCredit(rec);

  // Get release info (MB returns many versions: studio, live, compilations)
  const primaryRelease =
    Array.isArray(rec.releases) && rec.releases.length > 0
      ? rec.releases[0]
      : null;

  // Release title
  const releaseTitle =
    primaryRelease?.title ?? rec["first-release-date"] ?? null;

  // Year
  const date = primaryRelease?.date ?? rec["first-release-date"] ?? null;

  const year = date ? date.slice(0, 4) : null;

  // Score (MB returns 100 or ext:score weirdly)
  const score =
    typeof rec.score === "number"
      ? rec.score
      : rec["ext:score"]
      ? Number(rec["ext:score"])
      : null;

  return {
    id,
    title: rec.title ?? null,
    artist,
    year,
    releaseTitle,
    durationMs: rec.length ?? null,
    score,
  };
}
