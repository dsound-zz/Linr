/**
 * wikipediaCredits.ts
 *
 * Extracts credits from Wikipedia pages.
 * Only used to fill gaps when MusicBrainz data is missing or weak.
 * Lyrics are explicitly excluded.
 */

import { searchWikipediaTrack } from "../wikipedia";
import type { Credit, CreditRole, CreditsEntity } from "./types";
import { CONFIDENCE } from "./types";
import { normalizeRole, normalizeName } from "./normalizeCredits";

/**
 * Extract credits from Wikipedia personnel data
 * Wikipedia returns personnel as { name, role }[] array
 */
function extractPersonnelCredits(
  personnel: Array<{ name: string; role: string }>,
  missingRoles: CreditRole[],
): Credit[] {
  const credits: Credit[] = [];

  for (const person of personnel) {
    const roleLower = person.role.toLowerCase();

    // Check if role is an instrument keyword first
    const instrumentKeywords = [
      "keyboard",
      "keyboards",
      "guitar",
      "bass",
      "drums",
      "percussion",
      "vocals",
      "saxophone",
      "trumpet",
      "piano",
    ];
    const instrument = instrumentKeywords.find((kw) => roleLower.includes(kw));

    // If role is an instrument, treat as performer
    let normalizedRole = normalizeRole(person.role);
    if (instrument && !normalizedRole) {
      normalizedRole = "performer";
    }

    if (!normalizedRole) continue;

    // If missingRoles is empty, include all roles (sparse MB data case)
    // Otherwise, only include roles that are missing
    if (missingRoles.length > 0 && !missingRoles.includes(normalizedRole)) {
      continue;
    }

    credits.push({
      role: normalizedRole,
      name: normalizeName(person.name),
      instrument: instrument || undefined,
      source: "wikipedia",
      confidence: CONFIDENCE.WIKIPEDIA_MEDIUM,
    });
  }

  return credits;
}

/**
 * Extract credits from Wikipedia HTML text
 * Parses common patterns like "Producer: Name" or "Name - Producer"
 */
function extractTextCredits(
  html: string,
  missingRoles: CreditRole[],
): Credit[] {
  const credits: Credit[] = [];

  // Decode HTML entities
  const text = html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

  // Pattern: "Role: Name" or "Role: Name1, Name2"
  const roleNamePattern =
    /(?:^|\n)\s*([A-Z][a-z\s]+(?:engineer|producer|writer|composer|arranger|conductor)?):\s*([^\n]+)/g;

  let match;
  while ((match = roleNamePattern.exec(text)) !== null) {
    const roleStr = match[1].trim();
    const namesStr = match[2].trim();

    const role = normalizeRole(roleStr);
    if (!role || !missingRoles.includes(role)) continue;

    const names = namesStr.split(/[,&]/).map((n) => n.trim());
    for (const name of names) {
      if (name && name.length > 1) {
        credits.push({
          role,
          name: normalizeName(name),
          source: "wikipedia",
          confidence: CONFIDENCE.WIKIPEDIA_LOW, // Text parsing is less reliable
        });
      }
    }
  }

  return credits;
}

/**
 * Extract recording location from Wikipedia
 */
function extractRecordingLocation(text: string):
  | {
      studio?: string;
      city?: string;
      country?: string;
    }
  | undefined {
  // Look for "Recorded at" or "Studio" patterns
  const recordedPattern =
    /(?:Recorded|Recorded at|Studio):\s*([^\n,]+(?:,\s*[^\n]+)?)/i;
  const match = text.match(recordedPattern);

  if (!match) return undefined;

  const locationStr = match[1].trim();
  const parts = locationStr.split(",").map((p) => p.trim());

  return {
    studio: parts[0] || undefined,
    city: parts[1] || undefined,
    country: parts[2] || undefined,
  };
}

/**
 * Fetch credits from Wikipedia for an entity
 * Only fills missing roles - never overwrites MusicBrainz data
 */
export async function fetchWikipediaCredits(
  entity: CreditsEntity,
  missingRoles: CreditRole[],
): Promise<{
  credits: Credit[];
  recordingLocation?: { studio?: string; city?: string; country?: string };
}> {
  if (missingRoles.length === 0) {
    return { credits: [] };
  }

  const credits: Credit[] = [];

  // Try getWikipediaPersonnel first for structured personnel data
  try {
    const { getWikipediaPersonnel } = await import("../wikipedia");
    const personnel = await getWikipediaPersonnel(entity.title, entity.artist);

    // Extract from personnel array (primary source)
    if (personnel && Array.isArray(personnel) && personnel.length > 0) {
      const personnelCredits = extractPersonnelCredits(personnel, missingRoles);
      credits.push(...personnelCredits);
    }
  } catch (error) {
    // If getWikipediaPersonnel fails, continue with searchWikipediaTrack
    console.warn("Failed to fetch Wikipedia personnel:", error);
  }

  // If still missing roles, try searchWikipediaTrack for HTML parsing
  const foundRoles = new Set(credits.map((c) => c.role));
  const stillMissing = missingRoles.filter((r) => !foundRoles.has(r));

  if (stillMissing.length > 0) {
    try {
      const query = `${entity.title} ${entity.artist}`;
      const wikiResult = await searchWikipediaTrack(query);

      if (
        wikiResult &&
        typeof wikiResult === "object" &&
        "html" in wikiResult &&
        typeof wikiResult.html === "string"
      ) {
        const textCredits = extractTextCredits(wikiResult.html, stillMissing);
        credits.push(...textCredits);

        // Extract recording location from HTML
        const location = extractRecordingLocation(wikiResult.html as string);
        return { credits, recordingLocation: location };
      }
    } catch (error) {
      console.warn("Failed to fetch Wikipedia HTML:", error);
    }
  }

  return { credits };
}
