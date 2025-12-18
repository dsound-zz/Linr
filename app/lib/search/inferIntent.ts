import { parseUserQuery } from "@/lib/parseQuery";
import { getMBClient } from "@/lib/musicbrainz";
import { searchContributorsByName } from "./searchContributors";
import type { ContributorSearchResult, MusicBrainzArtist, MusicBrainzRecording } from "@/lib/types";

export type SearchIntent =
  | { type: "song"; title: string; artist?: string | null }
  | { type: "contributor"; name: string };

export interface IntentResolution {
  intent: SearchIntent;
  contributorMatches: ContributorSearchResult[];
}

const NAME_TOKEN_REGEX = /^[a-zA-ZÀ-ÖØ-öø-ÿ'.&-]+$/;

function shouldProbeContributors(tokens: string[], query: string): boolean {
  if (tokens.length >= 2 && tokens.length <= 5) {
    const validTokens = tokens.filter((token) => NAME_TOKEN_REGEX.test(token));
    if (validTokens.length === tokens.length) {
      return true;
    }
  }
  // If the query is title-like (quotes, separators) we avoid extra lookups
  const looksLikeTitle =
    /["“”]/.test(query) ||
    /\sby\s/i.test(query) ||
    /[-–—]/.test(query) ||
    /feat\.?|ft\.?/.test(query) ||
    /\(.*\)/.test(query);
  return !looksLikeTitle && tokens.length <= 4;
}

export async function inferSearchIntent(
  query: string,
): Promise<IntentResolution> {
  const normalized = query.trim();
  if (!normalized) {
    return {
      intent: { type: "song", title: "", artist: null },
      contributorMatches: [],
    };
  }

  const tokens = normalized.split(/\s+/).filter(Boolean);
  const looksLikePersonName =
    tokens.length >= 2 &&
    tokens.length <= 5 &&
    tokens.every((token) => NAME_TOKEN_REGEX.test(token));
  let contributorMatches: ContributorSearchResult[] = [];
  const parsed = parseUserQuery(normalized);

  const shouldSearchContributors = shouldProbeContributors(tokens, normalized);
  if (shouldSearchContributors) {
    contributorMatches = await searchContributorsByName(normalized, {
      limit: 5,
    });
  }

  const normalizedLower = normalized.toLowerCase();
  const hasExactContributorName = contributorMatches.some(
    (candidate) =>
      candidate.name.toLowerCase() === normalizedLower ||
      (candidate.disambiguation &&
        `${candidate.name} (${candidate.disambiguation})`
          .toLowerCase()
          .trim() === normalizedLower),
  );

  const exactMatch = contributorMatches.find(
    (candidate) =>
      candidate.name.toLowerCase() === normalizedLower ||
      (candidate.disambiguation &&
        `${candidate.name} (${candidate.disambiguation})`
          .toLowerCase()
          .trim() === normalizedLower),
  );

  if (exactMatch) {
    // Determine confidence based on contributor metadata quality
    // Only count meaningful musical roles, not generic types like "Group" or URL types
    const meaningfulRoles = exactMatch.roles.filter((role) => {
      const lowerRole = role.toLowerCase();
      return (
        !["group", "person", "character", "social network", "soundcloud", "youtube", "twitter", "facebook", "instagram"].includes(lowerRole)
      );
    });

    const hasSubstantialMetadata =
      meaningfulRoles.length > 0 ||
      exactMatch.knownFor.length > 0;

    // Check if disambiguation suggests a band/generic entity vs a primary artist
    const isBandDisambiguation =
      exactMatch.disambiguation &&
      (exactMatch.disambiguation.toLowerCase().includes("band") ||
        exactMatch.disambiguation.toLowerCase().includes("group"));

    const isWellKnownContributor = hasSubstantialMetadata && !isBandDisambiguation;

    if (isWellKnownContributor) {
      // High-confidence, well-documented contributor (e.g., "Nile Rodgers", "Max Martin")
      // These have roles and known works - clearly established artists
      return {
        intent: { type: "contributor", name: exactMatch.name },
        contributorMatches,
      };
    } else {
      // Lower confidence match - check if recordings dominate
      // This handles cases like "Le Freak" (bands with minimal metadata)
      const preferSong = await recordingsDominateQuery(normalized);
      if (preferSong) {
        return {
          intent: { type: "song", title: parsed.title, artist: parsed.artist },
          contributorMatches,
        };
      }
      return {
        intent: { type: "contributor", name: exactMatch.name },
        contributorMatches,
      };
    }
  }

  if (shouldSearchContributors && contributorMatches.length > 0) {
    // Always check if recordings dominate to avoid false positives
    const preferSong = await recordingsDominateQuery(normalized);
    if (preferSong) {
      return {
        intent: { type: "song", title: parsed.title, artist: parsed.artist },
        contributorMatches,
      };
    }
    return {
      intent: { type: "contributor", name: normalized },
      contributorMatches,
    };
  }

  if (looksLikePersonName) {
    const preferSong = await recordingsDominateQuery(normalized);
    if (!preferSong) {
      return {
        intent: { type: "contributor", name: normalized },
        contributorMatches,
      };
    }
  }

  return {
    intent: { type: "song", title: parsed.title, artist: parsed.artist },
    contributorMatches,
  };
}

async function recordingsDominateQuery(query: string): Promise<boolean> {
  try {
    const mb = getMBClient();
    const limit = 10; // Increased to get better signal

    // Add timeout to prevent slow searches from blocking intent detection
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Intent dominance check timeout')), 8000)
    );

    const searchPromise = Promise.all([
      mb.search("recording", { query, limit, offset: 0 }) as Promise<{
        recordings?: MusicBrainzRecording[];
        count?: number;
      }>,
      mb.search("artist", { query, limit, offset: 0 }) as Promise<{
        artists?: MusicBrainzArtist[];
        count?: number;
      }>,
    ]);

    const [recordingRes, artistRes] = await Promise.race([searchPromise, timeoutPromise]);

    // Only count high-quality matches (score >= 90) to avoid inflated counts from fuzzy matches
    const highScoreRecordings = Array.isArray(recordingRes?.recordings)
      ? recordingRes.recordings.filter((r: MusicBrainzRecording) => (r.score ?? 0) >= 90)
      : [];
    const highScoreArtists = Array.isArray(artistRes?.artists)
      ? artistRes.artists.filter((a: MusicBrainzArtist) => (a.score ?? 0) >= 90)
      : [];

    const recordingCount = highScoreRecordings.length;
    const artistCount = highScoreArtists.length;

    // If there are many high-quality recordings (3+) and few/no high-quality artists (0-1), strongly prefer song
    // This handles cases like "Kid Charlemagne" where there's 1 obscure artist but many song versions
    if (recordingCount >= 3 && artistCount <= 1) return true;

    if (artistCount === 0 && recordingCount > 0) return true;
    if (recordingCount === 0 && artistCount === 0) return true;
    return recordingCount >= artistCount * 1.5; // Recordings need to significantly dominate
  } catch (error) {
    console.error("Intent dominance check failed", error);
    // Default to false (prefer contributor) when timeout/error occurs
    return false;
  }
}
