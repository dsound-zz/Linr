import { getMBClient } from "@/lib/musicbrainz";
import type { MusicBrainzArtist } from "@/lib/types";
import type {
  ContributorIntentCandidate,
  ContributorIntentResult,
} from "./intentTypes";

const MAX_CANDIDATES = 3;

function normalizeScore(value?: number | null): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return 0;
  }
  return Math.min(Math.max(value / 100, 0), 1);
}

function matchesAlias(artist: MusicBrainzArtist, query: string): boolean {
  if (!Array.isArray(artist.aliases)) return false;
  return artist.aliases.some((alias) => {
    if (!alias?.name) return false;
    return alias.name.toLowerCase() === query;
  });
}

function computeGapBoost(
  index: number,
  baseScore: number,
  artists: MusicBrainzArtist[],
): number {
  if (index !== 0) return 0;
  if (artists.length === 1) return 0.15;

  const secondBase = normalizeScore(artists[1]?.score);
  const gap = baseScore - secondBase;
  if (gap >= 0.25) return 0.15;
  if (gap >= 0.15) return 0.08;
  if (gap >= 0.1) return 0.04;
  return 0;
}

function toCandidate(
  artist: MusicBrainzArtist,
  index: number,
  artists: MusicBrainzArtist[],
  normalizedQuery: string,
): ContributorIntentCandidate | null {
  if (!artist?.id || !artist?.name) return null;
  let score = normalizeScore(artist.score);
  const exactMatch = artist.name.toLowerCase() === normalizedQuery;
  const aliasMatch = matchesAlias(artist, normalizedQuery);
  if (exactMatch) score += 0.2;
  if (aliasMatch) score += 0.1;
  score += computeGapBoost(index, normalizeScore(artist.score), artists);
  score = Math.max(0, Math.min(1, score));

  return {
    id: artist.id,
    name: artist.name,
    disambiguation: artist.disambiguation ?? null,
    score: Number(score.toFixed(3)),
  };
}

export async function searchContributorIntent(
  query: string,
): Promise<ContributorIntentResult> {
  const trimmed = query.trim();
  if (!trimmed) {
    return { candidates: [] };
  }

  try {
    const mb = getMBClient();

    // Add timeout to prevent hanging on slow searches
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Contributor intent search timeout')), 10000)
    );

    // First try exact phrase search
    const exactSearchPromise = mb.search("artist", {
      query: `artist:"${trimmed}"`,
      limit: MAX_CANDIDATES,
    });

    const response = await Promise.race([exactSearchPromise, timeoutPromise]);

    let artists = Array.isArray(response?.artists)
      ? (response.artists as MusicBrainzArtist[])
      : [];

    // If exact search returns no results, try fuzzy search (without quotes)
    // This helps with misspellings like "nile rogers" -> "nile rodgers"
    if (artists.length === 0) {
      const fuzzyTimeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Fuzzy search timeout')), 5000)
      );

      const fuzzySearchPromise = mb.search("artist", {
        query: trimmed, // No quotes = fuzzy matching
        limit: MAX_CANDIDATES,
      });

      try {
        const fuzzyResponse = await Promise.race([fuzzySearchPromise, fuzzyTimeoutPromise]);
        artists = Array.isArray(fuzzyResponse?.artists)
          ? (fuzzyResponse.artists as MusicBrainzArtist[])
          : [];
      } catch (fuzzyError) {
        console.error("Fuzzy search failed", fuzzyError);
        // Keep artists as empty array
      }
    }

    const normalizedQuery = trimmed.toLowerCase();

    const candidates = artists
      .map((artist, index) => toCandidate(artist, index, artists, normalizedQuery))
      .filter((candidate): candidate is ContributorIntentCandidate => Boolean(candidate))
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_CANDIDATES);

    return { candidates };
  } catch (error) {
    console.error("searchContributorIntent failed", error);
    return { candidates: [] };
  }
}
