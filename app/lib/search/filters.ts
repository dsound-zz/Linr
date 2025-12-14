/**
 * filters.ts
 *
 * SMALL, STRICT filters only.
 * No fuzzy logic - these are boolean predicates.
 */

import type { NormalizedRecording } from "./types";

/**
 * Check if recording title exactly matches or is a prefix match of the query
 * e.g., "Jump" matches "Jump" and "Jump (2015 Remaster)"
 * Also handles featured artist titles: "Side to Side" matches "Side to Side (feat. Nicki Minaj)"
 */
export function isExactOrPrefixTitleMatch(
  recording: NormalizedRecording,
  queryTitle: string,
): boolean {
  const recTitle = normalize(recording.title);
  const q = normalize(queryTitle);

  if (!recTitle || !q) return false;

  // Exact match
  if (recTitle === q) return true;

  // Prefix match (e.g., "jump" matches "jump (remaster)")
  if (recTitle.startsWith(q)) return true;

  // Handle featured artist titles: strip "feat", "ft", "featuring", "with" and compare base title
  // e.g., "side to side feat nicki minaj" should match "side to side"
  const recTitleBase = recTitle
    .split(/\s+(feat|ft|featuring|with)\s+/i)[0]
    .trim();
  if (recTitleBase === q) return true;

  return false;
}

/**
 * Check if recording appears to be a studio recording
 * Filters out live, remix, demo, karaoke, etc.
 */
export function isStudioRecording(recording: NormalizedRecording): boolean {
  const title = recording.title.toLowerCase();
  const releases = recording.releases;

  // Check release secondary types
  //
  // IMPORTANT:
  // A canonical studio track often appears on compilations.
  // We should only reject the recording if *all* of its releases are "non-studio-ish"
  // (live/remix/dj-mix/mixtape), not merely because one compilation release exists.
  const badSecondaryTypes = new Set(["live", "remix", "dj-mix", "mixtape"]);
  const hasAnyRelease = releases.length > 0;
  const allReleasesAreBadSecondary =
    hasAnyRelease &&
    releases.every((r) =>
      r.secondaryTypes.some((t) => badSecondaryTypes.has(t.toLowerCase())),
    );

  if (allReleasesAreBadSecondary) return false;

  // Check title for bad keywords
  const badKeywords = [
    "live",
    "remaster",
    "remix",
    "mix",
    "dj",
    "edit",
    "demo",
    "rehearsal",
    "karaoke",
    "instrumental",
    "tribute",
    "cover",
    "alternate",
    "acoustic",
    "extended",
    "club",
    "dance",
    "radio edit",
    "sped up",
    "taylor's version",
    "re-recording",
  ];

  return !badKeywords.some((kw) => title.includes(kw));
}

/**
 * Check if recording has at least one Album or Single release
 * (filters out compilations, soundtracks, etc. as primary type)
 */
export function isAlbumOrSingleRelease(
  recording: NormalizedRecording,
): boolean {
  const releases = recording.releases;

  return releases.some((r) => {
    const primary = (r.primaryType ?? "").toLowerCase();
    return primary === "album" || primary === "single";
  });
}

/**
 * Check if recording has at least one US or worldwide release
 * (worldwide = null country, which is common for digital releases)
 */
export function isUSOrWorldwideRelease(
  recording: NormalizedRecording,
): boolean {
  const releases = recording.releases;

  return releases.some((r) => {
    const country = r.country?.toUpperCase();
    return country === "US" || country === null || country === "";
  });
}

/**
 * Normalize text for comparison
 */
function normalize(val: string): string {
  return val
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
