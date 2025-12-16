import * as React from "react";
import { useRouter } from "next/router";
import { ArrowLeft } from "lucide-react";

import type { ContributorProfile } from "@/lib/types";
import { cn } from "@/lib/utils";
import { AppLayout } from "@components/layout/app-layout";
import { RecordSpinner } from "@components/record-spinner";
import { Button } from "@components/ui/button";
import { surface, text } from "@styles/typeography";

export function ContributorPage() {
  const router = useRouter();
  const { name, from } = router.query;

  const [data, setData] = React.useState<ContributorProfile | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [offset, setOffset] = React.useState(0);
  const LIMIT = 20;

  React.useEffect(() => {
    if (!router.isReady) return undefined;
    if (typeof name !== "string") return undefined;

    setLoading(true);
    setError(null);
    setData(null);
    setOffset(0);

    const abortController = new AbortController();

    const params = new URLSearchParams({ name, limit: LIMIT.toString(), offset: "0" });
    fetch(`/api/contributor?${params.toString()}`, {
      signal: abortController.signal,
    })
      .then(async (res) => {
        const json = (await res.json()) as unknown;
        const err = (json as Record<string, unknown> | null)?.error;
        if (typeof err === "string" && err.length > 0) throw new Error(err);
        setData(json as ContributorProfile);
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
  }, [router.isReady, name]);

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
    if (typeof from === "string" && from) {
      router.push(`/recording/${from}`);
    } else {
      router.back();
    }
  };

  const handleRecordingClick = (id: string) => {
    router.push(`/recording/${id}`);
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
          </div>
        </div>

        {/* Role breakdown */}
        {data.roleBreakdown && data.roleBreakdown.length > 0 && (
          <div className={cn(surface.cardPadded, "space-y-4")}>
            <h2 className={text.sectionTitle}>Role Breakdown</h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
              {data.roleBreakdown.map((role) => (
                <div
                  key={role.role}
                  className={cn(
                    "rounded-lg border border-border bg-secondary/30 p-3",
                  )}
                >
                  <div className="text-2xl font-bold">{role.count}</div>
                  <div className={cn(text.meta, "capitalize")}>{role.role}</div>
                </div>
              ))}
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
                onClick={() => handleRecordingClick(contrib.recordingId)}
                className={cn(
                  "w-full rounded-xl border border-border bg-card p-4 text-left transition-colors",
                  "hover:bg-secondary/60",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
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
                  <div className="flex shrink-0 flex-wrap items-start justify-end gap-2">
                    {contrib.roles.map((role, idx) => (
                      <span key={idx} className={surface.badge}>
                        {role}
                      </span>
                    ))}
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
