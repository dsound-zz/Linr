// 1. Filter out live, remaster, remix, DJ mix, demo, karaoke, etc
import type { MusicBrainzRecording, MusicBrainzRelease, MusicBrainzArtistCreditEntry } from "./types";

export function isLikelyStudioVersion(rec: MusicBrainzRecording): boolean {
  const dis = rec.disambiguation?.toLowerCase() ?? "";
  const title = rec.title?.toLowerCase() ?? "";
  const releaseContext = (rec.releases ?? [])
    .map(
      (r: MusicBrainzRelease) =>
        `${r.disambiguation ?? ""} ${r.title ?? ""} ${
          r["release-group"]?.["secondary-types"]?.join(" ") ?? ""
        }`
    )
    .join(" ")
    .toLowerCase();

  const haystack = `${title} ${dis} ${releaseContext}`;

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
    "voice memo",
    "memo",
    "extended",
    "club",
    "dance",
    "track by track",
    "commentary",
    "house",
    "radio edit",
    "mastermix",
    '12"',
    "12-inch",
    "sped up",
    "sped",
    "explicit version",
    "clean version",
    "taylor's version",
    "re-recording",
    "80s", // catches “Best of the 80s”, “80s Collection”
    "90s", // future-proof
    "2000s",
  ];

  const hasBadSecondaryType = (rec.releases ?? []).some((r: MusicBrainzRelease) => {
    const secondary =
      (r["release-group"]?.["secondary-types"] ?? []).map((s: string) =>
        s.toLowerCase()
      );
    return secondary.some((t: string) =>
      ["live", "remix", "dj-mix", "mixtape", "compilation"].includes(t)
    );
  });

  if (hasBadSecondaryType) return false;

  return !badKeywords.some((kw) => haystack.includes(kw));
}

// 2. Artist matching stays the same for now

export function recordingMatchesArtist(rec: MusicBrainzRecording, artistName: string): boolean {
  const ac = rec["artist-credit"] ?? [];
  const target = artistName.toLowerCase().trim();

  return ac.some((entry: MusicBrainzArtistCreditEntry | string) => {
    const n =
      entry?.artist?.name ??
      entry?.name ??
      (typeof entry === "string" ? entry : "");

    if (!n) return false;

    const name = n.toLowerCase();

    // exact match
    if (name === target) return true;

    // contains
    if (name.includes(target)) return true;

    // remove punctuation, compare again
    const cleaned = name.replace(/[^a-z0-9]+/g, " ").trim();
    if (cleaned.includes(target)) return true;

    return false;
  });
}

// 3. Prefer US releases, fallback to anything
export function recordingHasUSRelease(rec: MusicBrainzRecording): boolean {
  const releases = rec.releases ?? [];
  return releases.some((r: MusicBrainzRelease) => r.country === "US");
}

// Prefer original album releases over compilations, singles, etc
export function isOriginalAlbumRelease(release: MusicBrainzRelease): boolean {
  const rg = release["release-group"];
  if (!rg) return false;

  const primary = (rg["primary-type"] || "").toLowerCase();

  if (primary !== "album") return false;

  const secondary = (rg["secondary-types"] || []).map((s: string) =>
    s.toLowerCase()
  );

  // reject albums labeled as compilations or mixes
  if (secondary.includes("compilation")) return false;
  if (secondary.includes("soundtrack")) return false;
  if (secondary.includes("remix")) return false;

  return true;
}
// Filter out releases whose titles clearly indicate a compilation
export function isNotCompilationTitle(release: MusicBrainzRelease): boolean {
  const rawTitle = release?.title?.toLowerCase() ?? "";
  const title = rawTitle.replace(/[()\\[\\]]/g, " ");

  const badTitleKeywords = [
    "greatest",
    "best of",
    "hits",
    "the hits",
    "collection",
    "anthology",
    "essentials",
    "the very best",
    "ultimate",
    "mega mix",
    "hit mix",
    "mixes",
    "remix",
    "80s",
    "90s",
    "2000s",
    "compilation",
    "(instrumental)"
  ];

  return !badTitleKeywords.some(
    (kw) => title.includes(kw) || rawTitle.includes(kw)
  );
}

// Release-level filter to drop obvious remixes/alt versions even if the recording slips through
export function isStudioReleaseTitle(release: MusicBrainzRelease): boolean {
  const rawHaystack = `${release?.title ?? ""} ${release?.disambiguation ?? ""}`
    .toLowerCase();
  const haystack = rawHaystack.replace(/[()\\[\\]]/g, " ");

  const badTitleKeywords = [
    "remix",
    "mix",
    "acoustic",
    "instrumental",
    "commentary",
    "track by track",
    "voice memo",
    "demo",
    "karaoke",
    "clean version",
    "explicit version",
    "sped up",
    "sped",
    "taylor's version",
    "re-recording",
    "orchestral",
    "symphonic",
  ];

  const secondary =
    (release?.["release-group"]?.["secondary-types"] ?? []).map((s: string) =>
      s.toLowerCase()
    );

  if (
    secondary.some((t: string) =>
      ["live", "remix", "dj-mix", "mixtape", "compilation"].includes(t)
    )
  ) {
    return false;
  }

  return !badTitleKeywords.some(
    (kw) => haystack.includes(kw) || rawHaystack.includes(kw)
  );
}

export function recordingTitleMatchesQuery(
  rec: MusicBrainzRecording,
  userTitle: string
): boolean {
  const recTitle = rec.title?.toLowerCase() ?? "";
  const cleanUser = userTitle.toLowerCase().trim();

  // Exact match is fine
  if (recTitle === cleanUser) return true;

  // Accept if recording title *starts with* the search
  // e.g. "Jump (2015 Remaster)" should match "jump"
  if (recTitle.startsWith(cleanUser)) return true;

  // Reject titles containing multiple repeated words (Jump Jump Jump)
  const wordCount = recTitle.split(/\s+/g).filter(Boolean).length;
  if (wordCount > 2 && !recTitle.includes(cleanUser)) return false;

  // Reject if title contains the search term more than once (Jump Jump Jump)
  const occurrences = recTitle.split(cleanUser).length - 1;
  if (occurrences > 1) return false;

  // Generic fallback: contains but not too different
  return recTitle.includes(cleanUser);
}

export function titleMatchesQuery(rec: MusicBrainzRecording, userTitle: string): boolean {
  const recTitle = normalize(rec.title);
  const q = normalize(userTitle);

  if (!recTitle || !q) return false;

  if (recTitle === q) return true;
  if (recTitle.startsWith(q)) return true;
  if (recTitle.includes(q)) return true;

  return false;
}

export function isRepeatedSingleWordTitle(
  rec: MusicBrainzRecording | { title?: string | null } | { title: string | null },
  userTitle: string
): boolean {
  return false;
}

export function isRepeatedTitleValue(
  title: string | null | undefined,
  userTitle: string
): boolean {
  return false;
}

const ALTERNATE_VERSION_KEYWORDS = [
  "club mix",
  "extended mix",
  "radio mix",
  "instrumental version",
  "remix version",
  "radio edit",
  "acoustic version",
  "strings version",
  "dub version",
  "instrumental",
  "remix",
  "acoustic",
  "demo",
  "karaoke",
  "dub",
  "orchestral",
  "reprise",
];

const ALT_KEYWORD_PATTERN = ALTERNATE_VERSION_KEYWORDS.map(escapeRegex).join("|");
const ALT_BRACKET_PATTERN = new RegExp(`[\\(\\[]\\s*(?:${ALT_KEYWORD_PATTERN})`, "i");
const ALT_HYPHEN_PATTERN = new RegExp(`[\\-–—]\\s*(?:${ALT_KEYWORD_PATTERN})`, "i");
const ALT_TRAILING_PATTERN = new RegExp(`(?:${ALT_KEYWORD_PATTERN})\\s*$`, "i");

export function isAlternateVersionTitle(title?: string | null): boolean {
  if (!title) return false;
  const normalized = title.toLowerCase();
  if (
    ALT_BRACKET_PATTERN.test(normalized) ||
    ALT_HYPHEN_PATTERN.test(normalized) ||
    ALT_TRAILING_PATTERN.test(normalized)
  ) {
    return true;
  }
  return false;
}

export function scoreRecordingMatch(
  rec: MusicBrainzRecording,
  userTitle: string,
  userArtist?: string | null
): number {
  let score = 0;

  const rawScore =
    typeof rec.score === "number"
      ? rec.score
      : rec["ext:score"]
      ? Number(rec["ext:score"])
      : null;

  if (rawScore != null && !isNaN(rawScore)) score += rawScore;

  const recTitle = normalize(rec.title);
  const q = normalize(userTitle);

  if (recTitle && q) {
    if (recTitle === q) score += 40;
    else if (recTitle.startsWith(q)) score += 30;
    else if (recTitle.includes(q)) score += 20;
    else {
      const recWords = new Set(recTitle.split(" "));
      const qWords = q.split(" ");
      const overlap = qWords.filter((w) => recWords.has(w)).length;
      score += overlap * 6;
    }
  }

  if (userArtist) {
    if (recordingMatchesArtist(rec, userArtist)) score += 25;
    else score -= 10;
  }

  if (isLikelyStudioVersion(rec)) score += 10;
  else score -= 20;

  if (recordingHasUSRelease(rec)) score += 5;

  const releases = rec.releases ?? [];
  if (releases.some(isOriginalAlbumRelease)) score += 10;
  if (!releases.some(isNotCompilationTitle)) score -= 5;

  const year =
    releases
      .map((r: MusicBrainzRelease) => parseInt(r.date?.slice(0, 4) ?? ""))
      .filter((y: number) => !isNaN(y))
      .sort((a: number, b: number) => a - b)[0] ?? null;

  if (year) {
    const ageBias = Math.max(0, new Date().getFullYear() - year);
    score += Math.min(10, ageBias / 5);
  }

  return score;
}

function normalize(val: string | null | undefined): string {
  return (val ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegex(val: string): string {
  return val.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}
