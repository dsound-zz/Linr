import { isOriginalAlbumRelease, isNotCompilationTitle } from "./filters";
import type { MusicBrainzRecording, MusicBrainzRelease } from "./types";

export function canonicalPick(recordings: MusicBrainzRecording[]): MusicBrainzRecording | null {
  if (!Array.isArray(recordings) || recordings.length === 0) return null;

  // STEP 1 — Filter to likely originals
  let pool = recordings.filter(
    (rec) => rec && rec.releases && rec.releases.length > 0,
  );

  if (pool.length === 0) return recordings[0];

  // STEP 2 — Remove recordings with "mix", "live", etc. (done earlier already)
  // but keep for safety
  pool = pool.filter(
    (rec) => rec.disambiguation == null || rec.disambiguation.trim() === "",
  );

  // STEP 3 — Prefer recordings with ALBUM releases (not compilations)
  const albumPreferred = pool.filter((rec) =>
    rec.releases?.some((r: MusicBrainzRelease) => isOriginalAlbumRelease(r)) ?? false,
  );

  if (albumPreferred.length > 0) pool = albumPreferred;

  // STEP 4 — Remove compilations like “Best of the 80s”
  const noCompilations = pool.filter((rec) => {
    return rec.releases?.some((r: MusicBrainzRelease) => isNotCompilationTitle(r)) ?? false;
  });

  if (noCompilations.length > 0) pool = noCompilations;

  // STEP 5 — Pick earliest release date among remaining
  pool.sort((a, b) => {
    const aDate = getEarliestReleaseYear(a);
    const bDate = getEarliestReleaseYear(b);
    return aDate - bDate;
  });

  return pool[0];
}

function getEarliestReleaseYear(rec: MusicBrainzRecording): number {
  if (!rec.releases) return Infinity;

  const years = rec.releases
    .map((r: MusicBrainzRelease) => (r.date ? parseInt(r.date.slice(0, 4)) : Infinity))
    .filter((y: number) => !isNaN(y));

  return years.length > 0 ? Math.min(...years) : Infinity;
}

export function pickCanonicalRecording(recordings: MusicBrainzRecording[]): MusicBrainzRecording | null {
  if (!recordings.length) return null;

  // Prefer those with an album release only
  let pool = recordings.filter((rec) =>
    rec.releases?.some((r: MusicBrainzRelease) => isOriginalAlbumRelease(r)),
  );

  // If none match album-only, fallback
  if (!pool.length) pool = recordings;

  // Sort by earliest release date
  pool.sort((a, b) => {
    const ay = getEarliestYear(a);
    const by = getEarliestYear(b);
    return ay - by;
  });

  return pool[0];
}

function getEarliestYear(rec: MusicBrainzRecording): number {
  const years =
    rec.releases
      ?.map((r: MusicBrainzRelease) => parseInt(r.date?.slice(0, 4) ?? ""))
      .filter((y: number) => !isNaN(y)) ?? [];

  return years.length ? Math.min(...years) : Infinity;
}
