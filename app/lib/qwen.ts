import { qwenClient } from "@/lib/qwen";
import { NORMALIZE_RECORDING_TEMPLATE } from "./prompts";
import { formatArtistCredit } from "./musicbrainz";
import { getWikipediaPersonnel } from "./wikipedia";
import { fetchDiscogsCredits } from "./discogs";
import type {
   NormalizedRecording,
   ExternalLinks, MusicBrainzRecording,
   MusicBrainzRelease, MusicBrainzRelation
} from "./types";

interface MusicBrainzWork {
  relations?: MusicBrainzRelation[];
  [key: string]: unknown; // For dynamic keys like "*-relation-list"
}

function canonicalPersonName(name: string | null | undefined): string {
  const cleaned = (name ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^\w\s]/g, "");
  return cleaned;
}

function cleanRole(role: string | null | undefined): string {
  if (!role) return "";
  return role
    .replace(/personnel|role|job/i, "")
    .replace(/[^\w\s]/g, "")
    .trim();
}

function getCanonicalRoles(personName: string, roles: string[]): string[] {
  // Extract known role keywords
  const allRoles = roles.map(cleanRole).filter(Boolean);

  // Return roles that aren't contained in the person's name
  return allRoles.filter(
    (role) =>
      role.length > 2 && // Skip short fragments
      !personName.toLowerCase().includes(role.toLowerCase()),
  );
}

function addCredit(
  mutableCredits: Map<string, Set<string>>,
  personName: string,
  role: string,
) {
  const canonicalName = canonicalPersonName(personName);
  if (!canonicalName) return;

  const currentRoles = mutableCredits.get(canonicalName) ?? new Set<string>();
  currentRoles.add(role);
  mutableCredits.set(canonicalName, currentRoles);
}

function mergeCredits(
  left: Map<string, Set<string>>,
  right: Map<string, Set<string>>,
): Map<string, Set<string>> {
  const merged = new Map(left);
  for (const [name, roles] of right.entries()) {
    const existingRoles = merged.get(name) ?? new Set<string>();
    for (const role of roles) {
      existingRoles.add(role);
    }
    merged.set(name, existingRoles);
  }
  return merged;
}

async function enrichWithWikipedia(
  recording: MusicBrainzRecording,
  release?: MusicBrainzRelease,
  releaseGroup?: Record<string, unknown>,
): Promise<Map<string, Set<string>>> {
  try {
    // Get title, artist for Wikipedia search
    const title = recording.title;
    const artist = formatArtistCredit(recording["artist-credit"]);
    if (!title || !artist) {
      return new Map();
    }

    // Get personnel from Wikipedia
    const personnel = await getWikipediaPersonnel(title, artist);
    if (!personnel || !Array.isArray(personnel.personnel)) {
      return new Map();
    }

    // Convert to our format
    const wikipediaCredits = new Map<string, Set<string>>();
    for (const p of personnel.personnel) {
      if (p.name && p.role) {
        addCredit(wikipediaCredits, p.name, p.role);
      }
    }

    return wikipediaCredits;
  } catch (error) {
    console.warn("Wikipedia enrichment failed:", error);
    return new Map();
  }
}

async function enrichWithDiscogs(
  recording: MusicBrainzRecording,
  release?: MusicBrainzRelease,
): Promise<Map<string, Set<string>>> {
  try {
    // Get title, artist for Discogs search
    const title = recording.title;
    const artist = formatArtistCredit(recording["artist-credit"]);
    if (!title || !artist) {
      return new Map();
    }

    // Get personnel from Discogs
    const personnel = await fetchDiscogsCredits(title, artist);
    if (!personnel || !Array.isArray(personnel.personnel)) {
      return new Map();
    }

    // Convert to our format
    const discogsCredits = new Map<string, Set<string>>();
    for (const p of personnel.personnel) {
      if (p.name && p.role) {
        addCredit(discogsCredits, p.name, p.role);
      }
    }

    return discogsCredits;
  } catch (error) {
    console.warn("Discogs enrichment failed:", error);
    return new Map();
  }
}

async function normalizeRecordingInner(
  recording: MusicBrainzRecording,
  release?: MusicBrainzRelease,
  releaseGroup?: Record<string, unknown>,
  allowExternal: boolean = true,
): Promise<Omit<NormalizedRecording, "id">> {
  // Start with MusicBrainz credits
  const initialCredits = new Map<string, Set<string>>();

  // Process recording-level relations
  if (recording.relations) {
    for (const relation of recording.relations) {
      if (
        relation.type === "performer" &&
        relation.direction === "forward" &&
        relation["target-type"] === "artist" &&
        relation.artist?.name &&
        relation.role
      ) {
        const roles = getCanonicalRoles(relation.artist.name, [
          relation.role,
          relation.instrument?.name ?? "",
        ]);
        for (const role of roles) {
          addCredit(initialCredits, relation.artist.name, role);
        }
      }
    }
  }

  // Process work-level relations (if we have work relations attached to recording)
  const workRelations = (recording as any)["work-relations"] as
    | MusicBrainzWork[]
    | undefined;
  if (workRelations) {
    for (const workRel of workRelations) {
      if (workRel.relations) {
        for (const relation of workRel.relations) {
          if (
            relation.type === "composer" &&
            relation.direction === "forward" &&
            relation["target-type"] === "artist" &&
            relation.artist?.name
          ) {
            addCredit(initialCredits, relation.artist.name, "composition");
          }
        }
      }
    }
  }

  // Enrich with external data sources
  let enrichedCredits = initialCredits;
  if (allowExternal) {
    const [wikipediaCredits, discogsCredits] = await Promise.all([
      enrichWithWikipedia(recording, release, releaseGroup),
      enrichWithDiscogs(recording, release),
    ]);
    enrichedCredits = mergeCredits(
      enrichedCredits,
      mergeCredits(wikipediaCredits, discogsCredits),
    );
  }

  // Prepare locations from recording
  const locations = [];
  if (recording.isrcs) {
    for (const isrc of recording.isrcs) {
      locations.push({
        type: "isrc",
        value: isrc,
      });
    }
  }

  // Prepare external links
  const externalLinks: ExternalLinks = {};
  if (recording.relations) {
    for (const relation of recording.relations) {
      if (relation.type === "streaming" && relation.url?.resource) {
        const url = relation.url.resource;
        if (url.includes("spotify.com")) {
          externalLinks.spotify = url;
        } else if (url.includes("youtube.com") || url.includes("youtu.be")) {
          externalLinks.youtube = url;
        } else if (url.includes("apple.com") || url.includes("itunes.apple.com")) {
          externalLinks.appleMusic = url;
        }
      }
    }
  }

  // Convert Map/Set structure to plain objects for serialization
  const credits: NormalizedRecording["credits"] = [];
  for (const [name, roles] of enrichedCredits.entries()) {
    credits.push({
      name,
      roles: Array.from(roles).sort(),
    });
  }

  // Sort credits by name for consistent ordering
  credits.sort((a, b) => a.name.localeCompare(b.name));

  return {
    title: recording.title,
    duration: recording.length, // milliseconds
    artist: formatArtistCredit(recording["artist-credit"]),
    releaseId: release?.id,
    releaseTitle: release?.title,
    releaseDate: release?.["first-release-date"],
    releaseCountry: release?.country,
    releaseLabel: release?.label,
    releaseBarcode: release?.barcode,
    releaseGroupPrimaryType: releaseGroup?.["primary-type"] as
      | "Album"
      | "Single"
      | "EP"
      | "Other"
      | undefined,
    releaseGroupId: releaseGroup?.id,
    releaseGroupTitle: releaseGroup?.title,
    credits,
    locations,
    externalLinks,
  };
}

export async function normalizeRecording(
  recording: MusicBrainzRecording,
  release?: MusicBrainzRelease,
  releaseGroup?: Record<string, unknown>,
  allowExternal: boolean = true,
): Promise<Omit<NormalizedRecording, "id">> {
  // Fallback to MusicBrainz-only if API key missing
  if (!process.env.QWEN_API_KEY) {
    return normalizeRecordingInner(recording, release, releaseGroup, allowExternal);
  }

  try {
    // Construct prompt from template
    const prompt = NORMALIZE_RECORDING_TEMPLATE.replace("{recording}", JSON.stringify(recording, null, 2))
      .replace("{release}", release ? JSON.stringify(release, null, 2) : "Not provided")
      .replace("{releaseGroup}", releaseGroup ? JSON.stringify(releaseGroup, null, 2) : "Not provided");

    const response = await qwenClient.chatCompletion([
      { role: "user", content: prompt }
    ]);

    // Extract and parse AI response
    const content = response.choices?.[0]?.message?.content;
    if (!content) {
      console.warn("Qwen response missing content, falling back to MusicBrainz-only normalization");
      return normalizeRecordingInner(recording, release, releaseGroup, allowExternal);
    }

    // Try to extract JSON from response (might be wrapped in markdown or text)
    const jsonMatch = content.match(/```json\n([\s\S]*?)\n```|```([\s\S]*?)```|(\{[\s\S]*?\})/);
    const jsonString = jsonMatch?.[1] || jsonMatch?.[2] || jsonMatch?.[3];
    
    if (!jsonString) {
      console.warn("Could not extract JSON from Qwen response, falling back to MusicBrainz-only normalization");
      return normalizeRecordingInner(recording, release, releaseGroup, allowExternal);
    }

    const parsed = JSON.parse(jsonString.trim());

    // Validate required fields exist in parsed response
    if (!parsed.title || !parsed.artist || !Array.isArray(parsed.credits)) {
      console.warn("Qwen response missing required fields, falling back to MusicBrainz-only normalization");
      return normalizeRecordingInner(recording, release, releaseGroup, allowExternal);
    }

    return parsed;
  } catch (err) {
    console.error("Qwen normalizeRecording failed, using derived fallback", err);
    return normalizeRecordingInner(recording, release, releaseGroup, allowExternal);
  }
}

export async function deriveRecordingFromMB(
  recording: MusicBrainzRecording,
  release?: MusicBrainzRelease,
  releaseGroup?: Record<string, unknown>,
  allowExternal: boolean = true,
): Promise<Omit<NormalizedRecording, "id">> {
  return normalizeRecordingInner(recording, release, releaseGroup, allowExternal);
}