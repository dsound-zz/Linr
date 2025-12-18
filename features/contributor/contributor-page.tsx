import * as React from "react";
import { useRouter } from "next/router";
import { ArrowLeft } from "lucide-react";

import type { ContributorProfile } from "@/lib/types";
import { cn } from "@/lib/utils";
import { AppLayout } from "@components/layout/app-layout";
import { RecordSpinner } from "@components/record-spinner";
import { Button } from "@components/ui/button";
import { surface, text } from "@styles/typeography";

// Client-side cache for contributor data (survives navigation)
const contributorCache = new Map<string, {
  data: ContributorProfile;
  timestamp: number;
}>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function getCacheKey(name: string, mbid?: string, fromSong?: string, fromArtist?: string, fromRoles?: string): string {
  return `${name}|${mbid || ''}|${fromSong || ''}|${fromArtist || ''}|${fromRoles || ''}`;
}

function getCachedData(key: string): ContributorProfile | null {
  const cached = contributorCache.get(key);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }
  if (cached) {
    contributorCache.delete(key);
  }
  return null;
}

function setCachedData(key: string, data: ContributorProfile): void {
  contributorCache.set(key, { data, timestamp: Date.now() });
}

export function ContributorPage() {
  const router = useRouter();
  const { name, mbid, from_song, from_artist, from_roles, from_recording_id } = router.query;

  const [data, setData] = React.useState<ContributorProfile | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [offset, setOffset] = React.useState(0);
  const LIMIT = 20;

  React.useEffect(() => {
    if (!router.isReady) return undefined;
    if (typeof name !== "string") return undefined;

    const cacheKey = getCacheKey(
      name,
      typeof mbid === "string" ? mbid : undefined,
      typeof from_song === "string" ? from_song : undefined,
      typeof from_artist === "string" ? from_artist : undefined,
      typeof from_roles === "string" ? from_roles : undefined
    );

    // Check cache first
    const cachedData = getCachedData(cacheKey);
    if (cachedData) {
      setData(cachedData);
      setOffset(0);
      setLoading(false);
      return undefined;
    }

    setLoading(true);
    setError(null);
    setData(null);
    setOffset(0);

    const abortController = new AbortController();

    const params = new URLSearchParams({ name, limit: LIMIT.toString(), offset: "0" });
    // Pass MBID if available for exact artist matching
    if (typeof mbid === "string" && mbid) {
      params.set("mbid", mbid);
    }
    // Pass song context for AI verification
    if (typeof from_song === "string" && from_song) {
      params.set("from_song", from_song);
    }
    if (typeof from_artist === "string" && from_artist) {
      params.set("from_artist", from_artist);
    }
    if (typeof from_roles === "string" && from_roles) {
      params.set("from_roles", from_roles);
    }
    fetch(`/api/contributor?${params.toString()}`, {
      signal: abortController.signal,
    })
      .then(async (res) => {
        const json = (await res.json()) as unknown;
        const err = (json as Record<string, unknown> | null)?.error;
        if (typeof err === "string" && err.length > 0) throw new Error(err);
        const contributorData = json as ContributorProfile;
        setData(contributorData);
        // Cache the data for future navigation
        setCachedData(cacheKey, contributorData);
      })
      .catch((err) => {
        if (err instanceof Error && err.name === "AbortError") return;
        setError(
          err instanceof Error ? err.message : "Failed to load contributor",
        );
      })
      .finally(() => {
        setLoading(false);
      });

    return () => {
      abortController.abort();
    };
  }, [router.isReady, name, mbid, from_song, from_artist, from_roles]);

  const handleLoadMore = async () => {
    if (!data || loadingMore || !data.hasMore || typeof name !== "string") return;

    setLoadingMore(true);
    const newOffset = offset + LIMIT;

    try {
      const params = new URLSearchParams({
        name,
        limit: LIMIT.toString(),
        offset: newOffset.toString(),
      });
      // Pass MBID if available for exact artist matching
      if (typeof mbid === "string" && mbid) {
        params.set("mbid", mbid);
      }
      // Pass song context for AI verification
      if (typeof from_song === "string" && from_song) {
        params.set("from_song", from_song);
      }
      if (typeof from_artist === "string" && from_artist) {
        params.set("from_artist", from_artist);
      }
      if (typeof from_roles === "string" && from_roles) {
        params.set("from_roles", from_roles);
      }

      const res = await fetch(`/api/contributor?${params.toString()}`);
      const json = (await res.json()) as unknown;
      const err = (json as Record<string, unknown> | null)?.error;
      if (typeof err === "string" && err.length > 0) throw new Error(err);

      const newData = json as ContributorProfile;

      // Append new contributions to existing data
      setData({
        ...newData,
        contributions: [...data.contributions, ...newData.contributions],
      });
      setOffset(newOffset);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load more recordings",
      );
    } finally {
      setLoadingMore(false);
    }
  };

  const handleBack = () => {
    // Always use browser back - matches browser back button behavior exactly
    router.back();
  };

  const handleRecordingClick = (recordingId: string, title: string, artist: string) => {
    // If this is an AI-inferred recording (not a real MusicBrainz ID), search for it instead
    if (recordingId.startsWith('ai-')) {
      // Search for the song by title and artist, with auto-navigation enabled
      const searchQuery = `${title} ${artist}`;
      router.push(`/?q=${encodeURIComponent(searchQuery)}&auto=1`);
      return;
    }

    // For real MusicBrainz recordings, navigate to the recording page
    // Pass the original recording ID forward so nested navigation can return to it
    const originalRecordingId = typeof from_recording_id === "string" && from_recording_id
      ? from_recording_id
      : null;

    const params = new URLSearchParams();
    if (originalRecordingId) {
      params.set("from_recording_id", originalRecordingId);
    }

    const url = params.toString()
      ? `/recording/${recordingId}?${params.toString()}`
      : `/recording/${recordingId}`;
    router.push(url);
  };

  if (loading) {
    return (
      <AppLayout>
        <div className="flex min-h-[400px] flex-col items-center justify-center gap-4">
          <RecordSpinner size={72} showTonearm className="opacity-95" />
          <div className={text.meta}>Loading contributor profile...</div>
        </div>
      </AppLayout>
    );
  }

  if (error && !data) {
    return (
      <AppLayout>
        <div className={cn(surface.cardPadded, "space-y-4")}>
          <div className="text-destructive">{error}</div>
          <Button onClick={handleBack} variant="outline">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Go Back
          </Button>
        </div>
      </AppLayout>
    );
  }

  if (!data) {
    return (
      <AppLayout>
        <div className={cn(surface.cardPadded, "space-y-4")}>
          <div className={text.meta}>No contributor data found.</div>
          <Button onClick={handleBack} variant="outline">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Go Back
          </Button>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Header with back button */}
        <div className={cn(surface.cardPadded, "space-y-4")}>
          <Button onClick={handleBack} variant="ghost" size="sm" className="mb-2">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Song
          </Button>

          <div>
            <h1 className={text.pageTitle}>{data.name}</h1>
            <div className={text.meta}>
              {data.totalContributions} contribution
              {data.totalContributions !== 1 ? "s" : ""} across{" "}
              {data.totalRecordings} recording
              {data.totalRecordings !== 1 ? "s" : ""}
            </div>
            {/* Legend for data sources */}
            {data.contributions.length > 0 && (
              <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
                <div className="flex items-center gap-1.5">
                  <span className={cn(surface.badge, "bg-yellow-500/20 text-yellow-700 dark:text-yellow-300")}>
                    role
                  </span>
                  <span className="text-muted-foreground">MusicBrainz</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className={cn(surface.badge, "bg-purple-500/20 text-purple-700 dark:text-purple-300")}>
                    role
                  </span>
                  <span className="text-muted-foreground">AI-inferred</span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Role breakdown */}
        {data.roleBreakdown && data.roleBreakdown.length > 0 && (
          <div className={cn(surface.cardPadded, "space-y-4")}>
            <h2 className={text.sectionTitle}>Role Breakdown</h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
              {data.roleBreakdown.map((role) => {
                // Always use singular form for role names (we're describing this person's role)
                let displayRole = role.role;
                if (displayRole.endsWith('s')) {
                  // Simple singularization: remove trailing 's'
                  displayRole = displayRole.slice(0, -1);
                }

                return (
                  <div
                    key={role.role}
                    className={cn(
                      "rounded-lg border border-border bg-secondary/30 p-3",
                    )}
                  >
                    <div className="text-2xl font-bold">{role.count}</div>
                    <div className={cn(text.meta, "capitalize")}>{displayRole}</div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Contributions list */}
        <div className={cn(surface.cardPadded, "space-y-4")}>
          <h2 className={text.sectionTitle}>Recordings</h2>
          <div className="space-y-3">
            {data.contributions.map((contrib) => (
              <button
                key={contrib.recordingId}
                type="button"
                onClick={() => handleRecordingClick(contrib.recordingId, contrib.title, contrib.artist)}
                className={cn(
                  "w-full rounded-xl border border-border bg-card p-4 text-left transition-colors",
                  "hover:bg-secondary/60",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                )}
              >
                <div className="flex flex-col gap-3">
                  <div className="min-w-0">
                    <div className="font-semibold">{contrib.title}</div>
                    <div className={cn(text.body, "text-muted-foreground")}>
                      {contrib.artist}
                    </div>
                    {contrib.releaseDate && (
                      <div className={cn(text.meta, "mt-1")}>
                        {contrib.releaseDate}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {contrib.roles.map((role, idx) => {
                      const isAiInferred = contrib.recordingId.startsWith('ai-');
                      return (
                        <span
                          key={idx}
                          className={cn(
                            surface.badge,
                            isAiInferred
                              ? "bg-purple-500/20 text-purple-700 dark:text-purple-300"
                              : "bg-yellow-500/20 text-yellow-700 dark:text-yellow-300"
                          )}
                        >
                          {role}
                        </span>
                      );
                    })}
                  </div>
                </div>
              </button>
            ))}
          </div>

          {/* Load More Button */}
          {data.hasMore && (
            <div className="flex justify-center pt-4">
              <Button
                onClick={handleLoadMore}
                disabled={loadingMore}
                variant="outline"
              >
                {loadingMore ? (
                  <span className="inline-flex items-center gap-2">
                    <RecordSpinner size={16} />
                    Loading more...
                  </span>
                ) : (
                  `Load More (${data.contributions.length} of ${data.totalRecordings})`
                )}
              </Button>
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
