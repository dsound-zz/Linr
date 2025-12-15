/**
 * artistPopularity.ts
 *
 * Fast, offline “popularity” seed list for artist-scoped searches.
 *
 * Why:
 * - The previous approach scored artists via additional MusicBrainz + Wikipedia calls.
 * - That added significant latency on cold cache / mobile networks.
 *
 * This module now returns a curated list of globally popular artists (across eras)
 * and optionally intersects it with candidates derived from the current query.
 */

// In-memory cache for popular artists list (refreshed periodically)
let cachedPopularArtists: string[] | null = null;
let cacheTimestamp: number = 0;
const POPULAR_ARTISTS_CACHE_TTL_MS = 3600000; // 1 hour

// A curated seed list. This is intentionally “wide”: the goal is to cheaply include
// obvious canonical artists without paying additional network calls.
//
// Notes:
// - This list is only used for *artist-scoped discovery* (recall), not as an exclusion
//   list. Obscure artists can still win via normal MusicBrainz results + scoring.
// - Keep names in their canonical display form used by MusicBrainz.
const POPULAR_ARTISTS_SEED = [
  // 1950s–1970s
  "The Beatles",
  "Elvis Presley",
  "The Rolling Stones",
  "Bob Dylan",
  "Aretha Franklin",
  "Stevie Wonder",
  "Marvin Gaye",
  "The Supremes",
  "The Beach Boys",
  "The Who",
  "Led Zeppelin",
  "Pink Floyd",
  "Queen",
  "David Bowie",
  "Elton John",
  "Fleetwood Mac",
  "ABBA",
  "Bee Gees",
  "Earth, Wind & Fire",
  "James Brown",
  "Ray Charles",
  "Johnny Cash",
  "Simon & Garfunkel",
  "Neil Young",
  "Prince",
  "Dolly Parton",

  // 1980s–1990s
  "Michael Jackson",
  "Madonna",
  "Whitney Houston",
  "U2",
  "Bruce Springsteen",
  "AC/DC",
  "Guns N' Roses",
  "Metallica",
  "Nirvana",
  "Pearl Jam",
  "Radiohead",
  "R.E.M.",
  "The Cure",
  "Depeche Mode",
  "The Police",
  "Bon Jovi",
  "Journey",
  "Phil Collins",
  "George Michael",
  "Céline Dion",
  "Mariah Carey",
  "Janet Jackson",
  "Tina Turner",
  "Sade",
  "Red Hot Chili Peppers",
  "Oasis",
  "Blur",
  "No Doubt",
  "Alanis Morissette",
  "Green Day",
  "Weezer",
  "Foo Fighters",
  "Rage Against the Machine",
  "Eminem",
  "2Pac",
  "The Notorious B.I.G.",
  "Jay-Z",
  "Kanye West",
  "Dr. Dre",
  "Snoop Dogg",
  "Outkast",
  "Aaliyah",
  "Beyoncé",
  "Destiny's Child",
  "Rihanna",

  // 2000s–2010s
  "Coldplay",
  "The Killers",
  "Linkin Park",
  "The White Stripes",
  "Arcade Fire",
  "Daft Punk",
  "Kendrick Lamar",
  "Drake",
  "The Weeknd",
  "Taylor Swift",
  "Adele",
  "Lady Gaga",
  "Bruno Mars",
  "Ed Sheeran",
  "Justin Bieber",
  "Katy Perry",
  "Ariana Grande",
  "Billie Eilish",
  "Dua Lipa",
  "Post Malone",
  "SZA",
  "Lizzo",
  "Miley Cyrus",
  "Harry Styles",
  "Olivia Rodrigo",
  "Doja Cat",
  "Bad Bunny",
  "Shakira",
  "BTS",

  // Jazz/Standards crossover (helps for common title queries)
  "Frank Sinatra",
  "Ella Fitzgerald",
  "Louis Armstrong",
] as const;

/**
 * Deduplicate while preserving order
 */
function uniq(list: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    const s = (item ?? "").trim();
    if (!s) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

/**
 * Get popular artists for artist-scoped recording searches
 *
 * Behavior:
 * - If candidateArtists are provided: prioritize those that appear in the seed list,
 *   then fill remaining slots with the seed list (still bounded by `limit`).
 * - If no candidates: return the seed list (bounded by `limit`).
 */
export async function getPopularArtists(
  limit: number = 50,
  candidateArtists?: string[],
): Promise<string[]> {
  // Otherwise, check cache
  const now = Date.now();
  if (
    cachedPopularArtists &&
    now - cacheTimestamp < POPULAR_ARTISTS_CACHE_TTL_MS
  ) {
    return cachedPopularArtists.slice(0, limit);
  }

  const seedLower = new Set(POPULAR_ARTISTS_SEED.map((a) => a.toLowerCase()));

  const prioritizedCandidates =
    candidateArtists && candidateArtists.length > 0
      ? candidateArtists.filter((a) => seedLower.has(a.toLowerCase()))
      : [];

  const popularArtists = uniq([
    ...prioritizedCandidates,
    ...POPULAR_ARTISTS_SEED,
  ]).slice(0, limit);

  // Cache the result
  cachedPopularArtists = popularArtists;
  cacheTimestamp = now;

  return popularArtists;
}
