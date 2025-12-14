/**
 * normalizeArtist.ts
 *
 * Normalizes artist names to extract primary artist and featured artists.
 * Handles common collaboration patterns like "feat.", "ft.", "featuring", "with", "&".
 */

export interface NormalizedArtist {
  primary: string;
  featured: string[];
}

/**
 * Normalize artist name to extract primary artist and featured artists
 *
 * @param raw - Raw artist credit string (e.g., "Ariana Grande feat. Nicki Minaj")
 * @returns Object with primary artist and array of featured artists
 *
 * @example
 * normalizeArtistName("Ariana Grande feat. Nicki Minaj")
 * // Returns: { primary: "Ariana Grande", featured: ["Nicki Minaj"] }
 *
 * @example
 * normalizeArtistName("The Weeknd")
 * // Returns: { primary: "The Weeknd", featured: [] }
 */
export function normalizeArtistName(raw: string): NormalizedArtist {
  const lower = raw.toLowerCase();

  const splitTokens = [
    " feat. ",
    " featuring ",
    " ft. ",
    " with ",
    " & ",
  ];

  for (const token of splitTokens) {
    if (lower.includes(token)) {
      const parts = raw.split(new RegExp(token, "i"));
      return {
        primary: parts[0].trim(),
        featured: parts.slice(1).map((p) => p.trim()),
      };
    }
  }

  return {
    primary: raw.trim(),
    featured: [],
  };
}

/**
 * Compare two artist names by their primary artist
 * Handles "feat." and collaboration patterns
 *
 * @param artist1 - First artist name
 * @param artist2 - Second artist name
 * @returns true if primary artists match (case-insensitive)
 */
export function artistsMatch(artist1: string, artist2: string): boolean {
  const norm1 = normalizeArtistName(artist1);
  const norm2 = normalizeArtistName(artist2);
  return norm1.primary.toLowerCase() === norm2.primary.toLowerCase();
}
