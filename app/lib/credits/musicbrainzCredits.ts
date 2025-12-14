/**
 * musicbrainzCredits.ts
 *
 * Fetches and extracts credits from MusicBrainz.
 * Uses recording, release, and release-group relationships.
 */

import { lookupRecording, lookupRelease } from "../musicbrainz";
import type { MusicBrainzRecording, MusicBrainzRelease } from "../types";
import type { Credit, CreditRole, CreditsEntity } from "./types";
import { CONFIDENCE } from "./types";

/**
 * MusicBrainz relationship type to our CreditRole mapping
 */
const MB_ROLE_MAP: Record<string, CreditRole> = {
  producer: "producer",
  "co-producer": "co_producer",
  "executive producer": "producer",
  writer: "writer",
  composer: "composer",
  lyricist: "lyricist", // Role only - no lyric content
  mixer: "mixer",
  "mixing engineer": "mixer",
  "recording engineer": "recording_engineer",
  "mastering engineer": "mastering_engineer",
  performer: "performer",
  "featured artist": "featured_artist",
  arranger: "arranger",
  conductor: "conductor",
  "art direction": "art_direction",
  "cover art": "cover_art",
  photography: "photography",
};

/**
 * Normalize MusicBrainz relationship type to our CreditRole
 */
function normalizeMBRole(mbType: string): CreditRole | null {
  const normalized = mbType.toLowerCase().trim();
  return MB_ROLE_MAP[normalized] || null;
}

/**
 * Extract credits from MusicBrainz recording relationships
 */
function extractRecordingCredits(recording: MusicBrainzRecording): Credit[] {
  const credits: Credit[] = [];
  const relations = recording.relations || [];

  for (const rel of relations) {
    const type = rel.type?.toLowerCase() || "";
    const role = normalizeMBRole(type);
    if (!role) continue;

    const artistRef: unknown = rel.artist ?? rel["target-credit"] ?? rel.name;
    let name = "";
    if (typeof artistRef === "string") {
      name = artistRef;
    } else if (
      artistRef &&
      typeof artistRef === "object" &&
      "name" in artistRef &&
      typeof (artistRef as { name?: unknown }).name === "string"
    ) {
      name = (artistRef as { name: string }).name;
    } else if (typeof rel.name === "string") {
      name = rel.name;
    }
    if (!name) continue;

    // Extract instrument from attributes if present
    const attributes = rel.attributes || [];
    const instrument = attributes
      .find((attr: string) => attr.toLowerCase().includes("instrument"))
      ?.replace(/instrument/i, "")
      .trim();

    credits.push({
      role,
      name,
      instrument,
      source: "musicbrainz",
      confidence: CONFIDENCE.MUSICBRAINZ_HIGH,
    });
  }

  return credits;
}

/**
 * Extract credits from MusicBrainz release relationships
 */
function extractReleaseCredits(release: MusicBrainzRelease): Credit[] {
  const credits: Credit[] = [];
  const relations = release.relations || [];

  for (const rel of relations) {
    const type = rel.type?.toLowerCase() || "";
    const role = normalizeMBRole(type);
    if (!role) continue;

    const artistRef: unknown = rel.artist ?? rel["target-credit"] ?? rel.name;
    let name = "";
    if (typeof artistRef === "string") {
      name = artistRef;
    } else if (
      artistRef &&
      typeof artistRef === "object" &&
      "name" in artistRef &&
      typeof (artistRef as { name?: unknown }).name === "string"
    ) {
      name = (artistRef as { name: string }).name;
    } else if (typeof rel.name === "string") {
      name = rel.name;
    }
    if (!name) continue;

    credits.push({
      role,
      name,
      source: "musicbrainz",
      confidence: CONFIDENCE.MUSICBRAINZ_MEDIUM, // Release credits slightly lower confidence
    });
  }

  return credits;
}

/**
 * Extract recording location from place relationships
 */
function extractRecordingLocation(
  recording: MusicBrainzRecording,
): { studio?: string; city?: string; country?: string } | undefined {
  const relations = recording.relations || [];
  const placeRels = relations.filter(
    (rel) => rel.type?.toLowerCase().includes("recorded") && rel.place,
  );

  if (placeRels.length === 0) return undefined;

  const place = placeRels[0].place;
  if (!place) return undefined;

  return {
    studio: place.name,
    city: place.area?.name,
    country: place["area"]?.["iso-3166-1-codes"]?.[0] || place.area?.name,
  };
}

/**
 * Fetch credits from MusicBrainz for a recording entity
 */
export async function fetchMusicBrainzCredits(entity: CreditsEntity): Promise<{
  credits: Credit[];
  recordingLocation?: { studio?: string; city?: string; country?: string };
}> {
  const credits: Credit[] = [];

  // Fetch recording if MBID provided
  if (entity.mbid) {
    try {
      const recording = await lookupRecording(entity.mbid);
      const recordingCredits = extractRecordingCredits(recording);
      credits.push(...recordingCredits);

      // Extract recording location
      const location = extractRecordingLocation(recording);
      if (location) {
        return { credits, recordingLocation: location };
      }
    } catch (error) {
      // If recording lookup fails, continue with release lookup
      console.warn(`Failed to lookup recording ${entity.mbid}:`, error);
    }
  }

  // Fetch release if release MBID provided (for album tracks)
  if (entity.releaseMbid) {
    try {
      const release = await lookupRelease(entity.releaseMbid);
      const releaseCredits = extractReleaseCredits(release);
      credits.push(...releaseCredits);
    } catch (error) {
      console.warn(`Failed to lookup release ${entity.releaseMbid}:`, error);
    }
  }

  return { credits };
}

/**
 * Detect missing or weak credit roles
 * Returns roles that should be filled from Wikipedia
 */
export function detectMissingRoles(
  mbCredits: Credit[],
  requiredRoles: CreditRole[] = [
    "producer",
    "writer",
    "composer",
    "mixer",
    "recording_engineer",
  ],
): CreditRole[] {
  const presentRoles = new Set(mbCredits.map((c) => c.role));
  return requiredRoles.filter((role) => !presentRoles.has(role));
}
