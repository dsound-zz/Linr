import { formatArtistCredit } from "./musicbrainz"; // make sure it's exported
import type { MusicBrainzRecording } from "./types";

export function normalizeRecording(rec: MusicBrainzRecording) {
  const id = rec.id;

  const artist = formatArtistCredit(rec);

  const primaryRelease =
    Array.isArray(rec.releases) && rec.releases.length > 0
      ? rec.releases[0]
      : null;

  const releaseTitle = primaryRelease?.title ?? null;
  const date = primaryRelease?.date ?? rec["first-release-date"] ?? null;
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
}
