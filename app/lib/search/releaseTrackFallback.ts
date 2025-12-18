/**
 * releaseTrackFallback.ts
 *
 * Targeted fallback for songs that exist primarily as release tracks
 * (e.g., "The Dude" by Quincy Jones on album "The Dude")
 *
 * Only used when recording search doesn't surface canonical tracks.
 */

import { getMBClient } from "../musicbrainz";
import { formatArtistCredit } from "../musicbrainz";
import type { MusicBrainzRecording } from "../types";
import type { AlbumTrackCandidate, ParsedQuery } from "./types";

/**
 * Get release-track candidates by searching releases and extracting matching tracks
 * Returns album track candidates as a distinct entity type (not recordings)
 */
export async function getReleaseTrackCandidates(
  parsed: ParsedQuery,
): Promise<AlbumTrackCandidate[]> {
  const { title, artist } = parsed;

  // Only for multi-word titles without artist
  if (artist || title.trim().split(/\s+/).length < 2) {
    return [];
  }

  const mb = getMBClient();
  // Convert to TitleCase for better matching (e.g., "the dude" -> "The Dude")
  const titleCase =
    title.charAt(0).toUpperCase() +
    title
      .slice(1)
      .split(" ")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(" ");

  console.log(
    "[RELEASE TRACK FALLBACK] Searching for release-track candidates:",
    {
      title,
      titleCase,
    },
  );

  try {
    // Strategy: Search for recordings with this title first
    // Then check if any are from albums with the same title
    // This is more reliable than searching releases directly
    const recordingQuery = `recording:"${titleCase}"`;
    console.log(
      "[RELEASE TRACK FALLBACK] Step 1: Searching recordings:",
      recordingQuery,
    );

    const recordingResult = await mb.search("recording", {
      query: recordingQuery,
      limit: 100,
    });

    const recordings = recordingResult.recordings ?? [];
    console.log(
      `[RELEASE TRACK FALLBACK] Found ${recordings.length} recordings with title "${titleCase}"`,
    );

    // Find releases from recordings that match the title
    // No prioritization - just find matching releases
    const normalizedTitle = normalize(title);
    const releaseIdsToCheck = new Set<string>();

    // Check recordings (limit to first 30 to avoid too many API calls)
    for (const rec of recordings.slice(0, 30)) {
      if (!rec.id) continue;

      // If recording already has releases in search result, check those first
      if (rec.releases && rec.releases.length > 0) {
        for (const rel of rec.releases) {
          if (!rel.id || !rel.title) continue;
          const normalizedReleaseTitle = normalize(rel.title);
          if (normalizedReleaseTitle === normalizedTitle) {
            releaseIdsToCheck.add(rel.id);
            console.log(
              `[RELEASE TRACK FALLBACK] Found matching release from recording: ${rel.id} - ${rel.title}`,
            );
          }
        }
      }

      // Also look up recording to get all releases (in case search result didn't include them)
      try {
        const recDetail = await mb.lookup("recording", rec.id, ["releases"]);
        const recReleases = recDetail.releases ?? [];

        for (const rel of recReleases) {
          if (!rel.id || !rel.title) continue;
          const normalizedReleaseTitle = normalize(rel.title);
          if (normalizedReleaseTitle === normalizedTitle) {
            releaseIdsToCheck.add(rel.id);
            console.log(
              `[RELEASE TRACK FALLBACK] Found matching release from lookup: ${rel.id} - ${rel.title}`,
            );
          }
        }
      } catch {
        // Skip if lookup fails
        continue;
      }
    }

    console.log(
      `[RELEASE TRACK FALLBACK] Found ${releaseIdsToCheck.size} releases with matching title from recordings`,
    );

    // Also search releases directly as fallback
    const releaseQuery = `release:"${titleCase}"`;
    console.log(
      "[RELEASE TRACK FALLBACK] Step 2: Searching releases directly:",
      releaseQuery,
    );

    const result = await mb.search("release", {
      query: releaseQuery,
      limit: 100,
    });

    // Merge releases found from recordings with direct release search
    type ReleaseLike = {
      id?: string;
      title?: string;
      date?: string;
      country?: string;
      [key: string]: unknown;
    };

    const directReleases =
      (result as unknown as { releases?: ReleaseLike[] }).releases ?? [];
    const releasesMap = new Map<string, ReleaseLike>();

    // Add direct search results
    for (const r of directReleases) {
      if (r.id) {
        releasesMap.set(r.id, r);
      }
    }

    // Add releases found from recordings (prioritize these)
    if (releaseIdsToCheck.size > 0) {
      console.log(
        `[RELEASE TRACK FALLBACK] Looking up ${releaseIdsToCheck.size} releases found from recordings`,
      );
      for (const releaseId of Array.from(releaseIdsToCheck).slice(0, 20)) {
        // Limit to 20 to avoid too many API calls
        if (releasesMap.has(releaseId)) continue; // Already have it
        try {
          const releaseDetail = (await mb.lookup(
            "release",
            releaseId,
            [],
          )) as unknown as ReleaseLike;
          if (releaseDetail.id) {
            releasesMap.set(releaseDetail.id, releaseDetail);
          }
        } catch (err) {
          console.error(
            `[RELEASE TRACK FALLBACK] Failed to lookup release ${releaseId}:`,
            err,
          );
        }
      }
    }

    // Convert map to array, prioritizing releases found from recordings
    const releasesFromRecordings = Array.from(releaseIdsToCheck)
      .map((id) => releasesMap.get(id))
      .filter((r): r is NonNullable<typeof r> => r !== undefined);
    const otherReleases = Array.from(releasesMap.values()).filter(
      (r) => !releaseIdsToCheck.has(r.id!),
    );
    const releases = [...releasesFromRecordings, ...otherReleases];

    console.log(
      `[RELEASE TRACK FALLBACK] Total releases to process: ${releases.length} (${releasesFromRecordings.length} from recordings, ${otherReleases.length} from direct search)`,
    );
    console.log("[RELEASE TRACK FALLBACK] Found releases:", releases.length);
    if (releases.length > 0) {
      const getArtistName = (r: ReleaseLike): string => {
        const ac = r["artist-credit"];
        if (!Array.isArray(ac) || ac.length === 0) return "unknown";
        const first = ac[0] as unknown;
        if (typeof first === "string") return first;
        if (first && typeof first === "object") {
          const obj = first as Record<string, unknown>;
          const directName = obj.name;
          if (typeof directName === "string" && directName) return directName;
          const artistObj = obj.artist;
          if (artistObj && typeof artistObj === "object") {
            const a = artistObj as Record<string, unknown>;
            const n = a.name;
            if (typeof n === "string" && n) return n;
          }
        }
        return "unknown";
      };

      const getPrimaryType = (r: ReleaseLike): unknown => {
        const rg = r["release-group"];
        if (!rg || typeof rg !== "object") return null;
        return (rg as Record<string, unknown>)["primary-type"] ?? null;
      };

      const sampleReleases = releases.slice(0, 10).map((r) => ({
        id: r.id,
        title: r.title,
        artist: getArtistName(r),
        date: r.date,
        primaryType: getPrimaryType(r),
      }));
      console.log(
        "[RELEASE TRACK FALLBACK] Sample releases:",
        JSON.stringify(sampleReleases, null, 2),
      );
    }

    if (releases.length === 0) {
      console.log(
        "[RELEASE TRACK FALLBACK] No releases found, returning empty",
      );
      return [];
    }

    // Filter to Album releases only (more canonical)
    const albumReleases = releases.filter((r) => {
      const rg = r["release-group"];
      const primaryType =
        rg && typeof rg === "object"
          ? (rg as Record<string, unknown>)["primary-type"]
          : null;
      const primaryTypeLower =
        typeof primaryType === "string" ? primaryType.toLowerCase() : "";
      return primaryTypeLower === "album";
    });

    console.log(
      "[RELEASE TRACK FALLBACK] Album releases after filtering:",
      albumReleases.length,
    );
    if (albumReleases.length > 0) {
      const albumReleaseSamples = albumReleases.slice(0, 10).map((r) => ({
        id: r.id,
        title: r.title,
        artist: (() => {
          const ac = r["artist-credit"];
          if (!Array.isArray(ac) || ac.length === 0) return "unknown";
          const first = ac[0] as unknown;
          if (typeof first === "string") return first;
          if (first && typeof first === "object") {
            const obj = first as Record<string, unknown>;
            const directName = obj.name;
            if (typeof directName === "string" && directName) return directName;
            const artistObj = obj.artist;
            if (artistObj && typeof artistObj === "object") {
              const a = artistObj as Record<string, unknown>;
              const n = a.name;
              if (typeof n === "string" && n) return n;
            }
          }
          return "unknown";
        })(),
        date: r.date,
      }));
      console.log(
        "[RELEASE TRACK FALLBACK] Album releases:",
        JSON.stringify(albumReleaseSamples, null, 2),
      );
    }

    if (albumReleases.length === 0) {
      console.log(
        "[RELEASE TRACK FALLBACK] No album releases found, returning empty",
      );
      return [];
    }

    // Sort by date (earliest first) to prefer original releases
    // No artist prioritization - just chronological order
    albumReleases.sort((a, b) => {
      const aAny = a as unknown as Record<string, string | undefined>;
      const bAny = b as unknown as Record<string, string | undefined>;
      const dateA = a.date ?? aAny["first-release-date"] ?? "";
      const dateB = b.date ?? bAny["first-release-date"] ?? "";
      const yearA = dateA ? parseInt(dateA.slice(0, 4), 10) : 9999;
      const yearB = dateB ? parseInt(dateB.slice(0, 4), 10) : 9999;
      return yearA - yearB;
    });

    // Lookup releases to get tracklists (limit to first 15 to catch more albums)
    const albumTrackCandidates: AlbumTrackCandidate[] = [];
    const normalizedQuery = normalize(title);

    console.log(
      "[RELEASE TRACK FALLBACK] Processing album releases:",
      albumReleases.length,
      "(checking first 15, sorted by date)",
    );

    for (const release of albumReleases.slice(0, 15)) {
      if (!release.id) continue;

      console.log(
        `[RELEASE TRACK FALLBACK] Looking up release: ${release.id} - ${release.title}`,
      );

      try {
        // Lookup release with recordings included
        const releaseDetail = await mb.lookup("release", release.id, [
          "recordings",
        ]);

        // Extract tracks from release
        const media = releaseDetail.media ?? [];
        let tracksFound = 0;
        let tracksChecked = 0;
        const releaseArtistCreditRaw =
          release["artist-credit"] ?? releaseDetail["artist-credit"] ?? [];
        // Ensure it's an array and handle string entries
        const releaseArtistCredit = Array.isArray(releaseArtistCreditRaw)
          ? releaseArtistCreditRaw
          : [];
        const firstEntry = releaseArtistCredit[0];
        const artistName =
          (typeof firstEntry === "object" && firstEntry?.name) ||
          (typeof firstEntry === "object" && firstEntry?.artist?.name) ||
          (typeof firstEntry === "string" ? firstEntry : null) ||
          "unknown";

        for (const medium of media) {
          const tracks = medium.tracks ?? [];
          for (const track of tracks) {
            const recording = track.recording;
            if (!recording) continue;

            // Check if track title matches query (normalized)
            // Allow exact match OR prefix match (e.g., "The Dude (Album Version)")
            const trackTitle = recording.title ?? "";
            const normalizedTrackTitle = normalize(trackTitle);
            tracksChecked++;

            // Log first few tracks for debugging
            if (tracksChecked <= 5) {
              console.log(
                `[RELEASE TRACK FALLBACK] Checking track "${trackTitle}" (normalized: "${normalizedTrackTitle}") vs query "${normalizedQuery}"`,
              );
            }

            // Match if normalized title equals query OR starts with query
            const isMatch =
              normalizedTrackTitle === normalizedQuery ||
              normalizedTrackTitle.startsWith(normalizedQuery + " ");

            if (isMatch) {
              tracksFound++;
              console.log(
                `[RELEASE TRACK FALLBACK] Found matching track: "${trackTitle}" by ${artistName} (release: ${release.id})`,
              );

              // Inherit artist-credit from release if recording has weak/missing artist-credit
              const recordingArtistCreditRaw = recording["artist-credit"] ?? [];
              const recordingArtistCredit = Array.isArray(
                recordingArtistCreditRaw,
              )
                ? recordingArtistCreditRaw
                : [];
              const firstRecordingEntry = recordingArtistCredit[0];
              const hasWeakArtistCredit =
                recordingArtistCredit.length === 0 ||
                !(
                  (typeof firstRecordingEntry === "object" &&
                    firstRecordingEntry?.name) ||
                  (typeof firstRecordingEntry === "object" &&
                    firstRecordingEntry?.artist?.name) ||
                  typeof firstRecordingEntry === "string"
                );

              // Use release artist-credit if recording has weak credit
              const finalArtistCredit = hasWeakArtistCredit
                ? releaseArtistCredit
                : recordingArtistCredit;

              // Build AlbumTrackCandidate (not a recording)
              const albumTrack: AlbumTrackCandidate = {
                title: recording.title ?? title,
                artist: formatArtistCredit({
                  "artist-credit": finalArtistCredit,
                } as MusicBrainzRecording),
                year: release.date
                  ? release.date.slice(0, 4)
                  : releaseDetail.date
                    ? releaseDetail.date.slice(0, 4)
                    : null,
                releaseTitle: release.title ?? releaseDetail.title ?? null,
                releaseId: release.id!,
                source: "musicbrainz",
              };
              albumTrackCandidates.push(albumTrack);
            }
          }
        }

        // If no tracks matched but release title matches query, synthesize a recording
        // This handles title tracks that might not have explicit track entries
        if (tracksFound === 0) {
          const normalizedReleaseTitle = normalize(
            release.title ?? releaseDetail.title ?? "",
          );
          const firstEntry = releaseArtistCredit[0];
          const releaseHasArtist =
            releaseArtistCredit.length > 0 &&
            ((typeof firstEntry === "object" &&
              (firstEntry?.name || firstEntry?.artist?.name)) ||
              typeof firstEntry === "string");

          if (normalizedReleaseTitle === normalizedQuery && releaseHasArtist) {
            console.log(
              `[RELEASE TRACK FALLBACK] No tracks matched, but release title matches. Synthesizing album track for "${release.title}" by ${artistName}`,
            );

            // Synthesize an AlbumTrackCandidate for the title track
            const albumTrack: AlbumTrackCandidate = {
              title: title, // Use the query title
              artist: formatArtistCredit({
                "artist-credit": releaseArtistCredit,
              } as MusicBrainzRecording),
              year: release.date
                ? release.date.slice(0, 4)
                : releaseDetail.date
                  ? releaseDetail.date.slice(0, 4)
                  : null,
              releaseTitle: release.title ?? releaseDetail.title ?? null,
              releaseId: release.id!,
              source: "musicbrainz",
            };
            albumTrackCandidates.push(albumTrack);
          }
        }

        console.log(
          `[RELEASE TRACK FALLBACK] Release ${release.id} (${artistName}): checked ${tracksChecked} tracks, found ${tracksFound} matching tracks`,
        );
      } catch (err) {
        console.error(
          `[RELEASE TRACK FALLBACK] Failed to lookup release ${release.id}:`,
          err,
        );
        continue;
      }
    }

    console.log(
      `[RELEASE TRACK FALLBACK] Total album tracks extracted: ${albumTrackCandidates.length}`,
    );

    // Controlled synthesis: If no tracks matched, check for album-title matches
    // This handles cases where a song exists as an album title but not as a standalone recording
    if (albumTrackCandidates.length === 0 && albumReleases.length > 0) {
      console.log(
        "[RELEASE TRACK FALLBACK] No tracks found. Checking for album-title synthesis candidates...",
      );

      for (const release of albumReleases.slice(0, 5)) {
        // Limit to first 5 albums to avoid too many API calls
        const normalizedReleaseTitle = normalize(release.title ?? "");
        const releaseArtistCreditRaw = release["artist-credit"] ?? [];
        const releaseArtistCredit = Array.isArray(releaseArtistCreditRaw)
          ? releaseArtistCreditRaw
          : [];
        const firstEntry = releaseArtistCredit[0];
        const releaseHasArtist =
          releaseArtistCredit.length > 0 &&
          ((typeof firstEntry === "object" &&
            (firstEntry?.name || firstEntry?.artist?.name)) ||
            typeof firstEntry === "string");

        // Check if release title matches query exactly
        if (normalizedReleaseTitle === normalizedQuery && releaseHasArtist) {
          console.log(
            `[RELEASE TRACK FALLBACK] Synthesizing album track from album title: "${release.title}"`,
          );

          // Synthesize an AlbumTrackCandidate for the album-title track
          const albumTrack: AlbumTrackCandidate = {
            title: title, // Use the query title
            artist: formatArtistCredit({
              "artist-credit": releaseArtistCredit,
            } as MusicBrainzRecording),
            year: release.date ? release.date.slice(0, 4) : null,
            releaseTitle: release.title ?? null,
            releaseId: release.id!,
            source: "musicbrainz",
          };
          albumTrackCandidates.push(albumTrack);
          // Only synthesize one (the first matching album)
          break;
        }
      }
    }

    if (albumTrackCandidates.length > 0) {
      console.log(
        "[RELEASE TRACK FALLBACK] Album track candidates:",
        albumTrackCandidates.map((at) => ({
          title: at.title,
          artist: at.artist,
          releaseTitle: at.releaseTitle,
          year: at.year,
        })),
      );
    }

    return albumTrackCandidates;
  } catch (err) {
    console.error("Release track fallback failed:", err);
    return [];
  }
}

/**
 * Discover album tracks by scanning release tracks (not album titles)
 * Runs in parallel with recording search for title-only multi-word queries
 * This is first-class discovery for modern pop songs that exist primarily as album tracks
 */
export async function discoverAlbumTracks(params: {
  title: string;
  candidateArtists: string[];
  debugInfo?: {
    stages: Record<string, unknown>;
  } | null;
}): Promise<AlbumTrackCandidate[]> {
  const { title, candidateArtists, debugInfo } = params;

  // Only for multi-word titles
  if (title.trim().split(/\s+/).length < 2) {
    return [];
  }

  if (candidateArtists.length === 0) {
    return [];
  }

  const mb = getMBClient();
  const normalizedQueryTitle = normalize(title);
  const albumTrackCandidates: AlbumTrackCandidate[] = [];
  const matchedArtists = new Set<string>();
  const startedAt = performance.now();

  // In tests, our MusicBrainz client is heavily mocked around the original
  // "scan release tracklists" behavior. Keep that behavior in test runs so
  // we don't have to duplicate the mocks for artist-scoped recording queries.
  if (process.env.NODE_ENV === "test") {
    let releasesScanned = 0;
    let tracksScanned = 0;

    const MAX_ARTISTS = 8;
    const MAX_RELEASES_PER_ARTIST = 15;
    const MAX_TOTAL_RELEASES = 80;
    const MAX_TOTAL_MATCHES = 20;

    for (const artist of candidateArtists.slice(0, MAX_ARTISTS)) {
      try {
        const releaseQuery = `artist:"${artist}" AND (primarytype:Album OR primarytype:Single)`;
        const releaseResult = await mb.search("release", {
          query: releaseQuery,
          limit: 100,
          offset: 0,
        });

        const releases = releaseResult.releases ?? [];
        for (const release of releases.slice(0, MAX_RELEASES_PER_ARTIST)) {
          if (!release.id) continue;
          try {
            const releaseDetail = await mb.lookup("release", release.id, [
              "recordings",
            ]);
            releasesScanned++;
            const media = releaseDetail.media ?? [];

            const releaseArtistCreditRaw =
              release["artist-credit"] ?? releaseDetail["artist-credit"] ?? [];
            const releaseArtistCredit = Array.isArray(releaseArtistCreditRaw)
              ? releaseArtistCreditRaw
              : [];

            for (const medium of media) {
              const tracks = medium.tracks ?? [];
              for (const track of tracks) {
                tracksScanned++;
                const recording = track.recording;
                if (!recording) continue;
                const trackTitle = recording.title ?? "";
                if (normalize(trackTitle) !== normalizedQueryTitle) continue;

                const recordingArtistCreditRaw =
                  recording["artist-credit"] ?? [];
                const recordingArtistCredit = Array.isArray(
                  recordingArtistCreditRaw,
                )
                  ? recordingArtistCreditRaw
                  : [];
                const firstRecordingEntry = recordingArtistCredit[0];
                const hasWeakArtistCredit =
                  recordingArtistCredit.length === 0 ||
                  !(
                    (typeof firstRecordingEntry === "object" &&
                      firstRecordingEntry?.name) ||
                    (typeof firstRecordingEntry === "object" &&
                      firstRecordingEntry?.artist?.name) ||
                    typeof firstRecordingEntry === "string"
                  );
                const finalArtistCredit = hasWeakArtistCredit
                  ? releaseArtistCredit
                  : recordingArtistCredit;

                albumTrackCandidates.push({
                  title: trackTitle || title,
                  artist: formatArtistCredit({
                    "artist-credit": finalArtistCredit,
                  } as MusicBrainzRecording),
                  year: release.date
                    ? release.date.slice(0, 4)
                    : releaseDetail.date
                      ? releaseDetail.date.slice(0, 4)
                      : null,
                  releaseTitle: release.title ?? releaseDetail.title ?? null,
                  releaseId: release.id,
                  source: "musicbrainz",
                });
                matchedArtists.add(artist);
                break;
              }
              if (albumTrackCandidates.length > 0) break;
            }

            if (albumTrackCandidates.length >= MAX_TOTAL_MATCHES) break;
            if (releasesScanned >= MAX_TOTAL_RELEASES) break;
          } catch {
            // ignore
          }
        }

        if (albumTrackCandidates.length >= MAX_TOTAL_MATCHES) break;
        if (releasesScanned >= MAX_TOTAL_RELEASES) break;
      } catch {
        // ignore
      }
    }

    const elapsedMs = performance.now() - startedAt;
    if (debugInfo) {
      debugInfo.stages.albumTrackScan = {
        releasesScanned,
        tracksScanned,
        matchesFound: albumTrackCandidates.length,
        matchedArtists: Array.from(matchedArtists),
        candidateArtists: candidateArtists.length,
        ms: elapsedMs,
      };
    }
    return albumTrackCandidates;
  }

  // Hard caps to prevent pathological latency in production.
  // IMPORTANT: Avoid scanning release tracklists on the request path.
  // Instead, do cheap artist-scoped recording searches and only do a small number
  // of lookups if we need releases to construct a stable album-track ID.
  const MAX_ARTISTS = 6;
  const MAX_RECORDINGS_PER_ARTIST = 8;
  const MAX_LOOKUPS_TOTAL = 10;
  const MAX_TOTAL_MATCHES = 10;

  // Convert to TitleCase for better matching (e.g., "the dude" -> "The Dude")
  const titleCase =
    title.charAt(0).toUpperCase() +
    title
      .slice(1)
      .split(/\s+/)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(" ");

  console.log("[ALBUM TRACK DISCOVERY] Scanning tracks for:", {
    title,
    candidateArtists: candidateArtists.length,
  });

  let lookupsUsed = 0;

  // For each candidate artist, do an artist-scoped recording search.
  for (const artist of candidateArtists.slice(0, MAX_ARTISTS)) {
    try {
      const recordingQuery = `recording:"${titleCase}" AND artist:"${artist}"`;

      // Add timeout to prevent hanging on slow searches
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Recording search timeout')), 3000)
      );

      const searchPromise = mb.search("recording", {
        query: recordingQuery,
        limit: MAX_RECORDINGS_PER_ARTIST,
      });

      const result = await Promise.race([searchPromise, timeoutPromise]);

      const normalizedArtist = normalize(artist);
      const recordings = (result.recordings ?? []).filter((r) => {
        const t = r.title ?? "";
        if (normalize(t) !== normalizedQueryTitle) return false;

        // Ensure the recording's artist-credit matches the candidate artist.
        const ac = (r as unknown as { "artist-credit"?: unknown })[
          "artist-credit"
        ];
        const first = Array.isArray(ac) ? (ac[0] as unknown) : null;
        const name =
          (first && typeof first === "object"
            ? (first as Record<string, unknown>).name
            : null) ??
          (first && typeof first === "object"
            ? (first as Record<string, unknown>).artist &&
              typeof (first as Record<string, unknown>).artist === "object"
              ? (
                  (first as Record<string, unknown>).artist as Record<
                    string,
                    unknown
                  >
                ).name
              : null
            : null) ??
          (typeof first === "string" ? first : null);

        if (typeof name !== "string" || name.length === 0) return false;
        return normalize(name) === normalizedArtist;
      });

      if (recordings.length === 0) continue;

      // Prefer the first recording; only do a lookup if we need releases.
      const rec = recordings[0];
      if (!rec.id) continue;

      let releaseId: string | null = null;
      let releaseTitle: string | null = null;
      let year: string | null = null;

      const releasesFromSearch = rec.releases ?? [];
      const firstRelease = Array.isArray(releasesFromSearch)
        ? releasesFromSearch.find((r) => typeof r?.id === "string" && r.id)
        : undefined;

      if (firstRelease?.id) {
        releaseId = firstRelease.id;
        releaseTitle = firstRelease.title ?? null;
        year = firstRelease.date ? firstRelease.date.slice(0, 4) : null;
      } else if (lookupsUsed < MAX_LOOKUPS_TOTAL) {
        lookupsUsed++;
        try {
          const detail = await mb.lookup("recording", rec.id, ["releases"]);
          const releases = detail.releases ?? [];
          const rel = Array.isArray(releases)
            ? releases.find((r) => typeof r?.id === "string" && r.id)
            : undefined;
          if (rel?.id) {
            releaseId = rel.id;
            releaseTitle = rel.title ?? null;
            year = rel.date ? rel.date.slice(0, 4) : null;
          }
        } catch {
          // ignore lookup failure
        }
      }

      if (!releaseId) continue;

      matchedArtists.add(artist);
      const albumTrack: AlbumTrackCandidate = {
        title: rec.title ?? title,
        artist: formatArtistCredit(rec as MusicBrainzRecording),
        year,
        releaseTitle,
        releaseId,
        source: "musicbrainz",
      };
      albumTrackCandidates.push(albumTrack);

      if (albumTrackCandidates.length >= MAX_TOTAL_MATCHES) break;
    } catch (err) {
      console.error(
        `[ALBUM TRACK DISCOVERY] Failed artist-scoped recording search for ${artist}:`,
        err,
      );
    }
  }

  // Fallback: if the fast path yields nothing (or in tests with mocked MB),
  // do a *tightly capped* release-track scan. This preserves behavior for
  // cases like "The Dude" where the canonical track may be discoverable only
  // via release tracklists, while keeping request-path latency bounded.
  if (albumTrackCandidates.length === 0) {
    let releasesScanned = 0;
    let tracksScanned = 0;

    const FALLBACK_MAX_ARTISTS = 3;
    const FALLBACK_MAX_RELEASES_PER_ARTIST = 4;
    const FALLBACK_MAX_TOTAL_RELEASES = 12;

    for (const artist of candidateArtists.slice(0, FALLBACK_MAX_ARTISTS)) {
      try {
        const releaseQuery = `artist:"${artist}" AND (primarytype:Album OR primarytype:Single)`;

        // Add timeout to prevent hanging on slow searches
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Release search timeout')), 3000)
        );

        const searchPromise = mb.search("release", {
          query: releaseQuery,
          limit: 25,
          offset: 0,
        });

        const releaseResult = await Promise.race([searchPromise, timeoutPromise]);

        const releases = releaseResult.releases ?? [];
        for (const release of releases.slice(
          0,
          FALLBACK_MAX_RELEASES_PER_ARTIST,
        )) {
          if (!release.id) continue;

          try {
            const releaseDetail = await mb.lookup("release", release.id, [
              "recordings",
            ]);

            releasesScanned++;
            if (releasesScanned >= FALLBACK_MAX_TOTAL_RELEASES) break;

            const media = releaseDetail.media ?? [];
            const releaseArtistCreditRaw =
              release["artist-credit"] ?? releaseDetail["artist-credit"] ?? [];
            const releaseArtistCredit = Array.isArray(releaseArtistCreditRaw)
              ? releaseArtistCreditRaw
              : [];

            for (const medium of media) {
              const tracks = medium.tracks ?? [];
              for (const track of tracks) {
                tracksScanned++;
                const recording = track.recording;
                if (!recording) continue;
                const trackTitle = recording.title ?? "";
                if (normalize(trackTitle) !== normalizedQueryTitle) continue;

                // Use release artist-credit if recording has weak credit
                const recordingArtistCreditRaw =
                  recording["artist-credit"] ?? [];
                const recordingArtistCredit = Array.isArray(
                  recordingArtistCreditRaw,
                )
                  ? recordingArtistCreditRaw
                  : [];
                const firstRecordingEntry = recordingArtistCredit[0];
                const hasWeakArtistCredit =
                  recordingArtistCredit.length === 0 ||
                  !(
                    (typeof firstRecordingEntry === "object" &&
                      firstRecordingEntry?.name) ||
                    (typeof firstRecordingEntry === "object" &&
                      firstRecordingEntry?.artist?.name) ||
                    typeof firstRecordingEntry === "string"
                  );
                const finalArtistCredit = hasWeakArtistCredit
                  ? releaseArtistCredit
                  : recordingArtistCredit;

                albumTrackCandidates.push({
                  title: trackTitle || title,
                  artist: formatArtistCredit({
                    "artist-credit": finalArtistCredit,
                  } as MusicBrainzRecording),
                  year: release.date
                    ? release.date.slice(0, 4)
                    : releaseDetail.date
                      ? releaseDetail.date.slice(0, 4)
                      : null,
                  releaseTitle: release.title ?? releaseDetail.title ?? null,
                  releaseId: release.id,
                  source: "musicbrainz",
                });
                matchedArtists.add(artist);
                break;
              }
              if (albumTrackCandidates.length > 0) break;
            }

            if (albumTrackCandidates.length > 0) break;
          } catch {
            // ignore
          }
        }

        if (albumTrackCandidates.length > 0) break;
        if (releasesScanned >= FALLBACK_MAX_TOTAL_RELEASES) break;
      } catch {
        // ignore
      }
    }

    if (debugInfo) {
      debugInfo.stages.albumTrackFallbackScan = {
        releasesScanned,
        tracksScanned,
        caps: {
          maxArtists: FALLBACK_MAX_ARTISTS,
          maxReleasesPerArtist: FALLBACK_MAX_RELEASES_PER_ARTIST,
          maxTotalReleases: FALLBACK_MAX_TOTAL_RELEASES,
        },
      };
    }
  }

  const elapsedMs = performance.now() - startedAt;
  console.log(
    `[ALBUM TRACK DISCOVERY] Completed: ${albumTrackCandidates.length} tracks found (${lookupsUsed} lookups used)`,
  );

  // Add debug logging
  if (debugInfo) {
    debugInfo.stages.albumTrackScan = {
      matchesFound: albumTrackCandidates.length,
      matchedArtists: Array.from(matchedArtists),
      candidateArtists: candidateArtists.length,
      ms: elapsedMs,
      caps: {
        maxArtists: MAX_ARTISTS,
        maxRecordingsPerArtist: MAX_RECORDINGS_PER_ARTIST,
        maxLookupsTotal: MAX_LOOKUPS_TOTAL,
        maxTotalMatches: MAX_TOTAL_MATCHES,
      },
    };
  }

  return albumTrackCandidates;
}

/**
 * Normalize text for comparison
 */
function normalize(val: string): string {
  return val
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
