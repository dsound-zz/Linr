import { NextRequest, NextResponse } from "next/server";
import type { ContributorProfile } from "@/lib/types";
import { getMBClient, lookupRecording } from "@/lib/musicbrainz";
import type { MusicBrainzRecording } from "@/lib/types";

/**
 * GET /api/contributor
 *
 * Aggregates all recordings where a person contributed.
 * Searches MusicBrainz for recordings with this person in artist-rels.
 *
 * Strategy:
 * 1. Fast search to get all recording IDs (up to 200)
 * 2. Do detailed lookups for first 20 recordings to get relationship data
 * 3. Return quickly with rich data for first page
 *
 * Query params:
 *   - name: The contributor's name (required)
 *   - limit: Number of recordings to return (default 20, max 50)
 *   - offset: Offset for pagination (default 0)
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const name = searchParams.get("name");
  const limitParam = searchParams.get("limit");
  const offsetParam = searchParams.get("offset");

  const limit = limitParam ? Math.min(parseInt(limitParam, 10), 50) : 20;
  const offset = offsetParam ? parseInt(offsetParam, 10) : 0;

  if (!name || typeof name !== "string" || name.trim().length === 0) {
    return NextResponse.json(
      { error: "Missing or invalid 'name' parameter" },
      { status: 400 },
    );
  }

  try {
    const mb = getMBClient();

    // Step 1: Find the artist by name to get their MBID
    const artistSearchResult = await mb.search("artist", {
      query: `artist:"${name.trim()}"`,
      limit: 5,
    });

    const artists = artistSearchResult.artists ?? [];
    if (artists.length === 0) {
      return NextResponse.json({
        name,
        totalContributions: 0,
        totalRecordings: 0,
        hasMore: false,
        roleBreakdown: [],
        contributions: [],
      } as ContributorProfile);
    }

    // Use the top matching artist
    const artistId = artists[0].id;
    if (!artistId) {
      return NextResponse.json({
        name,
        totalContributions: 0,
        totalRecordings: 0,
        hasMore: false,
        roleBreakdown: [],
        contributions: [],
      } as ContributorProfile);
    }

    // Step 2: Search for all recordings that credit this artist
    // This includes both recordings where they're the main artist and contributor
    const mainArtistQuery = `arid:${artistId}`;
    const pageSize = 100;
    const maxResults = 200;
    const recordings: MusicBrainzRecording[] = [];
    const recordingIds = new Set<string>();

    for (
      let offset = 0;
      offset < maxResults && recordings.length < maxResults;
      offset += pageSize
    ) {
      const result = await mb.search("recording", {
        query: mainArtistQuery,
        limit: pageSize,
        offset,
      });

      const rawRecordings = result.recordings ?? [];
      for (const rec of rawRecordings) {
        if (rec.id && !recordingIds.has(rec.id)) {
          recordingIds.add(rec.id);
          recordings.push(rec);
        }
      }

      if (rawRecordings.length < pageSize) break;
    }

    if (recordings.length === 0) {
      return NextResponse.json({
        name,
        totalContributions: 0,
        totalRecordings: 0,
        hasMore: false,
        roleBreakdown: [],
        contributions: [],
      } as ContributorProfile);
    }

    // Step 3: For the requested page, do detailed lookups to get relationship data
    const totalRecordings = recordings.length;
    const pageRecordings = recordings.slice(offset, offset + limit);

    // Do detailed lookups in parallel for this page
    const detailedRecordings = await Promise.all(
      pageRecordings.map(async (rec) => {
        if (!rec.id) return rec;
        try {
          // Lookup with artist relationships to get detailed role information
          const detailed = await lookupRecording(rec.id);
          return detailed || rec;
        } catch {
          return rec; // Fallback to search result if lookup fails
        }
      })
    );

    // Build contributions list and aggregate roles
    const contributionsMap = new Map<
      string,
      {
        recordingId: string;
        title: string;
        artist: string;
        releaseDate: string | null;
        roles: Set<string>;
      }
    >();

    const roleCountMap = new Map<string, number>();

    for (const recording of detailedRecordings) {
      const recordingId = recording.id;
      if (!recordingId) continue;

      const title = recording.title ?? "Unknown Title";

      // Extract artist name from artist-credit (handle both string and object types)
      const firstCredit = recording["artist-credit"]?.[0];
      let artist = "Unknown Artist";
      if (typeof firstCredit === "string") {
        artist = firstCredit;
      } else if (firstCredit) {
        artist = firstCredit.name ?? firstCredit.artist?.name ?? "Unknown Artist";
      }

      // Extract release date
      const releaseDate =
        recording.releases?.[0]?.date ??
        recording["first-release-date"] ??
        null;

      // Extract roles from artist-credit relationships
      const roles = new Set<string>();

      // Check artist-credit for the matching name
      const artistCredits = recording["artist-credit"] ?? [];
      for (const credit of artistCredits) {
        // Handle both string and object types in artist-credit
        if (typeof credit === "string") {
          if (credit.toLowerCase().includes(name.toLowerCase())) {
            roles.add("performer");
          }
        } else {
          const creditName = credit.name || credit.artist?.name;
          if (creditName?.toLowerCase().includes(name.toLowerCase())) {
            // This is a performing artist credit
            roles.add("performer");
          }
        }
      }

      // Extract from relations (if available)
      const relations = (recording as any).relations ?? [];
      for (const rel of relations) {
        const relType = rel.type?.toLowerCase() ?? "";
        const relArtist = rel.artist;

        // Check if this relation is for our contributor
        const relArtistName = relArtist?.name ?? "";
        const relArtistId = relArtist?.id ?? "";

        if (relArtistId === artistId || relArtistName.toLowerCase().includes(name.toLowerCase())) {
          // Get instrument/attribute if available for more specific role
          const attributes = rel.attributes ?? [];
          const attributeStr = attributes.join(", ");

          // Map MusicBrainz relation types to friendly role names
          if (relType.includes("producer")) {
            roles.add(attributeStr || "producer");
          } else if (relType.includes("composer") || relType.includes("writer")) {
            roles.add(attributeStr || "writer");
          } else if (relType.includes("engineer")) {
            if (relType.includes("mix")) {
              roles.add("mixing engineer");
            } else if (relType.includes("master")) {
              roles.add("mastering engineer");
            } else {
              roles.add(attributeStr || "recording engineer");
            }
          } else if (relType.includes("lyricist")) {
            roles.add("lyricist");
          } else if (relType.includes("vocal")) {
            roles.add(attributeStr || "vocals");
          } else if (relType.includes("instrument")) {
            // Use the attribute (instrument name) if available
            roles.add(attributeStr || "performer");
          } else if (relType) {
            roles.add(attributeStr || relType);
          }
        }
      }

      // If no specific role found, default to performer
      if (roles.size === 0) {
        roles.add("performer");
      }

      // Update role counts
      for (const role of roles) {
        roleCountMap.set(role, (roleCountMap.get(role) ?? 0) + 1);
      }

      // Add to contributions map (dedupe by recording ID)
      if (!contributionsMap.has(recordingId)) {
        contributionsMap.set(recordingId, {
          recordingId,
          title,
          artist,
          releaseDate,
          roles: new Set(),
        });
      }

      // Merge roles
      const existing = contributionsMap.get(recordingId)!;
      for (const role of roles) {
        existing.roles.add(role);
      }
    }

    // Convert to arrays and sort
    const contributions = Array.from(contributionsMap.values())
      .map((c) => ({
        ...c,
        roles: Array.from(c.roles).sort(),
      }))
      .sort((a, b) => {
        // Sort by release date descending (newest first)
        if (a.releaseDate && b.releaseDate) {
          return b.releaseDate.localeCompare(a.releaseDate);
        }
        if (a.releaseDate) return -1;
        if (b.releaseDate) return 1;
        return 0;
      });

    const roleBreakdown = Array.from(roleCountMap.entries())
      .map(([role, count]) => ({ role, count }))
      .sort((a, b) => b.count - a.count); // Sort by count descending

    const totalContributions = Array.from(contributionsMap.values()).reduce(
      (sum, c) => sum + c.roles.size,
      0,
    );

    const profile: ContributorProfile = {
      name,
      totalContributions,
      totalRecordings,
      hasMore: offset + limit < totalRecordings,
      roleBreakdown,
      contributions,
    };

    return NextResponse.json(profile);
  } catch (err) {
    console.error("Contributor API error:", err);
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Failed to fetch contributor data",
      },
      { status: 500 },
    );
  }
}
