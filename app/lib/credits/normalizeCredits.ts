/**
 * normalizeCredits.ts
 *
 * Normalizes credit roles and names across sources.
 * Handles role aliases and name variations.
 */

import type { Credit, CreditRole } from "./types";

/**
 * Role aliases - maps variations to canonical roles
 */
const ROLE_ALIASES: Record<string, CreditRole> = {
  // Producer variations
  "executive producer": "producer",
  "associate producer": "co_producer",
  "assistant producer": "co_producer",
  "co-producer": "co_producer",
  "co producer": "co_producer",

  // Writer variations
  songwriter: "writer",
  "song writer": "writer",

  // Composer variations
  "music composer": "composer",
  "music composition": "composer",

  // Engineer variations
  "mixing engineer": "mixer",
  "mix engineer": "mixer",
  "recording engineer": "recording_engineer",
  "record engineer": "recording_engineer",
  "mastering engineer": "mastering_engineer",
  "master engineer": "mastering_engineer",

  // Performer variations
  musician: "performer",
  "backing musician": "performer",
  "session musician": "performer",

  // Featured artist variations
  "feat.": "featured_artist",
  feat: "featured_artist",
  featuring: "featured_artist",
  "ft.": "featured_artist",
  ft: "featured_artist",

  // Art variations
  "art director": "art_direction",
  "art direction": "art_direction",
  "cover artist": "cover_art",
  "album art": "cover_art",
  photographer: "photography",
  "cover photo": "photography",
};

/**
 * Normalize a role string to a canonical CreditRole
 */
export function normalizeRole(role: string): CreditRole | null {
  const normalized = role.toLowerCase().trim();

  // Check direct match first
  if (normalized in ROLE_ALIASES) {
    return ROLE_ALIASES[normalized];
  }

  // Check if it's already a canonical role
  const canonicalRoles: CreditRole[] = [
    "producer",
    "co_producer",
    "writer",
    "composer",
    "lyricist",
    "mixer",
    "recording_engineer",
    "mastering_engineer",
    "performer",
    "featured_artist",
    "arranger",
    "conductor",
    "art_direction",
    "cover_art",
    "photography",
  ];

  if (canonicalRoles.includes(normalized as CreditRole)) {
    return normalized as CreditRole;
  }

  // Check aliases (substring matching)
  for (const [alias, canonical] of Object.entries(ROLE_ALIASES)) {
    if (normalized.includes(alias) || alias.includes(normalized)) {
      return canonical;
    }
  }

  // Check if role contains instrument keywords (treat as performer)
  const instrumentKeywords = [
    "keyboard",
    "guitar",
    "bass",
    "drums",
    "percussion",
    "vocals",
    "saxophone",
    "trumpet",
    "piano",
    "violin",
    "cello",
  ];
  if (instrumentKeywords.some((kw) => normalized.includes(kw))) {
    return "performer";
  }

  return null;
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
    .replace(/&#(\d+);/g, (match, dec) => String.fromCharCode(dec));
}

/**
 * Normalize a person's name
 * Removes extra whitespace, handles common variations, decodes HTML entities
 */
export function normalizeName(name: string): string {
  return decodeHtmlEntities(name)
    .trim()
    .replace(/\s+/g, " ")
    .replace(/^Dr\.\s+/i, "")
    .replace(/^Mr\.\s+/i, "")
    .replace(/^Ms\.\s+/i, "")
    .replace(/^Mrs\.\s+/i, "");
}

/**
 * Normalize credits by role and name
 */
export function normalizeCredits(credits: Credit[]): Credit[] {
  return credits
    .map((credit) => {
      const normalizedRole = normalizeRole(credit.role);
      if (!normalizedRole) return null;
      return {
        ...credit,
        name: normalizeName(credit.name),
        role: normalizedRole,
        // Also decode HTML entities in instrument field if present
        instrument: credit.instrument
          ? decodeHtmlEntities(credit.instrument).trim()
          : undefined,
      } as Credit;
    })
    .filter((credit): credit is Credit => credit !== null);
}
