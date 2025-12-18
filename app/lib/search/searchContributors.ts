import { getMBClient, formatArtistCredit } from "@/lib/musicbrainz";
import type {
  ContributorKnownFor,
  ContributorSearchResult,
  MusicBrainzArtist,
  MusicBrainzRecording,
  MusicBrainzRelation,
} from "@/lib/types";

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 7;
const KNOWN_FOR_LIMIT = 3;
const CACHE_TTL_MS = 1000 * 60 * 5;

type ArtistLookup = MusicBrainzArtist & {
  relations?: MusicBrainzRelation[];
  tags?: Array<{ name?: string | null }>;
};

const contributorCache = new Map<
  string,
  { timestamp: number; items: ContributorSearchResult[] }
>();

const RELATION_ROLE_LABELS: Record<string, string> = {
  producer: "Producer",
  "executive producer": "Producer",
  composer: "Composer",
  lyricist: "Lyricist",
  arranger: "Arranger",
  conductor: "Conductor",
  engineer: "Engineer",
  "mixing engineer": "Mix Engineer",
  "mastering engineer": "Mastering",
  "recording engineer": "Engineer",
  "vocal arranger": "Arranger",
  "instrumental arranger": "Arranger",
};

const TAG_ROLE_KEYWORDS: Array<{ keyword: string; label: string }> = [
  { keyword: "producer", label: "Producer" },
  { keyword: "songwriter", label: "Songwriter" },
  { keyword: "composer", label: "Composer" },
  { keyword: "lyricist", label: "Lyricist" },
  { keyword: "arranger", label: "Arranger" },
  { keyword: "conductor", label: "Conductor" },
  { keyword: "vocalist", label: "Vocalist" },
  { keyword: "singer", label: "Vocalist" },
  { keyword: "guitarist", label: "Guitar" },
  { keyword: "bassist", label: "Bass" },
  { keyword: "drummer", label: "Drums" },
  { keyword: "dj", label: "DJ" },
  { keyword: "engineer", label: "Engineer" },
];

function titleCase(value: string): string {
  return value
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function inferRoleFromRelation(rel: MusicBrainzRelation): string | null {
  const relationType = rel.type?.toLowerCase();
  if (relationType && RELATION_ROLE_LABELS[relationType]) {
    return RELATION_ROLE_LABELS[relationType];
  }
  if (relationType === "instrument") {
    const attr = rel.attributes?.[0];
    if (typeof attr === "string" && attr.trim()) {
      return titleCase(attr.trim());
    }
  }
  const attribute = rel.attributes?.[0];
  if (attribute && typeof attribute === "string") {
    return titleCase(attribute.trim());
  }
  if (relationType && relationType.trim()) {
    return titleCase(relationType.trim());
  }
  return null;
}

function inferRoles(detail: ArtistLookup): string[] {
  const roleCounts = new Map<string, number>();

  for (const rel of detail.relations ?? []) {
    const role = inferRoleFromRelation(rel);
    if (!role) continue;
    const normalized = role.toLowerCase();
    roleCounts.set(normalized, (roleCounts.get(normalized) ?? 0) + 1);
  }

  for (const tag of detail.tags ?? []) {
    const name = tag.name?.toLowerCase();
    if (!name) continue;
    for (const { keyword, label } of TAG_ROLE_KEYWORDS) {
      if (name.includes(keyword)) {
        const normalized = label.toLowerCase();
        roleCounts.set(normalized, (roleCounts.get(normalized) ?? 0) + 1);
      }
    }
  }

  if (roleCounts.size === 0 && detail.type) {
    const normalized = detail.type.toLowerCase();
    roleCounts.set(normalized, 1);
  }

  return Array.from(roleCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([role]) => titleCase(role))
    .slice(0, 4);
}

async function fetchKnownFor(
  artistId: string,
): Promise<ContributorKnownFor[]> {
  try {
    const mb = getMBClient();

    // Add timeout to prevent hanging on popular artists
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Known-for search timeout')), 8000)
    );

    const searchPromise = mb.search("recording", {
      query: `arid:${artistId}`,
      limit: KNOWN_FOR_LIMIT * 2,
      offset: 0,
    });

    const searchResult = await Promise.race([searchPromise, timeoutPromise]);

    const recordings = Array.isArray(searchResult?.recordings)
      ? (searchResult.recordings as MusicBrainzRecording[])
      : [];

    return recordings
      .slice(0, KNOWN_FOR_LIMIT)
      .map((recording) => ({
        title: recording.title ?? "Untitled",
        artist: formatArtistCredit(recording),
        recordingMBID: recording.id ?? undefined,
      }))
      .filter((entry) => Boolean(entry.title));
  } catch (error) {
    console.error("Failed to fetch known recordings for contributor", error);
    return [];
  }
}

async function lookupArtistDetail(id: string): Promise<ArtistLookup | null> {
  try {
    const mb = getMBClient();
    const lookup = mb.lookup as unknown as (
      entity: string,
      mbid: string,
      inc: string[],
    ) => Promise<ArtistLookup>;

    // Add timeout to prevent hanging
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Artist lookup timeout')), 10000)
    );

    const lookupPromise = lookup.call(mb, "artist", id, [
      "aliases",
      "tags",
      "recording-rels",
      "release-rels",
      "work-rels",
      "url-rels",
    ]);

    return await Promise.race([lookupPromise, timeoutPromise]);
  } catch (error) {
    console.error(`Failed to lookup artist ${id}`, error);
    return null;
  }
}

export async function searchContributorsByName(
  name: string,
  opts?: { limit?: number },
): Promise<ContributorSearchResult[]> {
  const trimmed = name.trim();
  if (!trimmed) return [];

  const limit = Math.min(
    Math.max(opts?.limit ?? DEFAULT_LIMIT, 1),
    MAX_LIMIT,
  );
  const cacheKey = `${trimmed.toLowerCase()}::${limit}`;
  const cached = contributorCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.items;
  }

  const mb = getMBClient();
  try {
    const searchQuery = `artist:"${trimmed}"`;
    const response = await mb.search("artist", { query: searchQuery, limit });
    const artists = Array.isArray(response?.artists)
      ? (response.artists as MusicBrainzArtist[])
      : [];

    // Process artists in parallel instead of sequentially
    const results: ContributorSearchResult[] = await Promise.all(
      artists
        .filter((artist): artist is MusicBrainzArtist & { id: string; name: string } =>
          Boolean(artist?.id && artist?.name)
        )
        .map(async (artist) => {
          try {
            // Run detail lookup and knownFor fetch in parallel
            const [detail, knownFor] = await Promise.all([
              lookupArtistDetail(artist.id),
              fetchKnownFor(artist.id),
            ]);

            const artistDetail = detail ?? artist;
            const roles = inferRoles(artistDetail);

            return {
              artistMBID: artist.id,
              name: (artistDetail?.name ?? artist.name) ?? name,
              disambiguation: artistDetail?.disambiguation ?? undefined,
              roles,
              knownFor,
              area: artistDetail?.area?.name ?? null,
            };
          } catch (error) {
            console.error(`Failed to process artist ${artist.id}:`, error);
            // Return minimal result on error
            return {
              artistMBID: artist.id,
              name: artist.name ?? name,
              disambiguation: artist.disambiguation ?? undefined,
              roles: artist.type ? [titleCase(artist.type)] : [],
              knownFor: [],
              area: artist.area?.name ?? null,
            };
          }
        })
    );

    contributorCache.set(cacheKey, { timestamp: Date.now(), items: results });
    return results;
  } catch (error) {
    console.error("Contributor search failed", error);
    return [];
  }
}
