/**
 * normalize.ts
 *
 * Converts raw MusicBrainz recordings into normalized internal shape.
 * This is a pure transformation - no filtering or scoring.
 */

import { formatArtistCredit } from "../musicbrainz";
import type { MusicBrainzRecording } from "../types";
import type { NormalizedRecording, ReleaseInfo } from "./types";

/**
 * Normalize a MusicBrainz recording into our internal format
 */
export function normalizeRecording(
  rec: MusicBrainzRecording,
  source?: "release-track" | "musicbrainz" | "album-title-inferred",
): NormalizedRecording {
  const id = rec.id ?? "";
  const title = rec.title ?? "";
  const artist = formatArtistCredit(rec);

  // Extract release information
  const releases: ReleaseInfo[] = (rec.releases ?? []).map((r) => ({
    title: r.title ?? null,
    year: r.date ? r.date.slice(0, 4) : null,
    country: r.country ?? null,
    primaryType: r["release-group"]?.["primary-type"] ?? null,
    secondaryTypes: r["release-group"]?.["secondary-types"] ?? [],
  }));

  // Extract score (MB returns score or ext:score)
  const score =
    typeof rec.score === "number"
      ? rec.score
      : rec["ext:score"]
        ? Number(rec["ext:score"])
        : null;

  // Preserve flags from raw recording
  const recAsAny = rec as unknown as Record<string, unknown>;
  const fromObviousSongProbe = recAsAny.fromObviousSongProbe === true;

  return {
    id,
    title,
    artist,
    releases,
    lengthMs: rec.length ?? null,
    score,
    source: source ?? "musicbrainz",
    ...(fromObviousSongProbe && { fromObviousSongProbe: true }),
  };
}

/**
 * Normalize multiple recordings
 */
export function normalizeRecordings(
  recordings: MusicBrainzRecording[],
  source?: "release-track" | "musicbrainz" | "album-title-inferred",
): NormalizedRecording[] {
  return recordings.map((rec) => normalizeRecording(rec, source));
}
