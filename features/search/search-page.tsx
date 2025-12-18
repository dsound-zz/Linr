import * as React from "react";
import { useRouter } from "next/router";
import { X, Clock } from "lucide-react";

import type { ContributorResult, SongResult } from "@/lib/types";
import { cn } from "@/lib/utils";
import { AppLayout } from "@components/layout/app-layout";
import { RecordSpinner } from "@components/record-spinner";
import { Button } from "@components/ui/button";
import { Input } from "@components/ui/input";
import { surface, text } from "@styles/typeography";
import type { IntentSearchResponse } from "@/lib/search/intentTypes";

const RECENT_SEARCHES_KEY = "linr_recent_searches";
const MAX_RECENT_SEARCHES = 5;

function getRecentSearches(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const stored = localStorage.getItem(RECENT_SEARCHES_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function saveRecentSearch(query: string) {
  if (typeof window === "undefined") return;
  try {
    const recent = getRecentSearches();
    // Remove if already exists
    const filtered = recent.filter((q) => q !== query);
    // Add to front
    const updated = [query, ...filtered].slice(0, MAX_RECENT_SEARCHES);
    localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(updated));
  } catch {
    // Ignore localStorage errors
  }
}

export function SearchPage() {
  const router = useRouter();

  const [query, setQuery] = React.useState("");
  const [recordingResults, setRecordingResults] = React.useState<SongResult[]>([]);
  const [contributorResults, setContributorResults] = React.useState<ContributorResult[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [recentSearches, setRecentSearches] = React.useState<string[]>([]);
  const [intent, setIntent] = React.useState<"song" | "contributor" | null>(null);
  const [mode, setMode] = React.useState<"canonical" | "ambiguous" | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const abortControllerRef = React.useRef<AbortController | null>(null);

  // Load recent searches on mount
  React.useEffect(() => {
    setRecentSearches(getRecentSearches());
  }, []);

  // Auto-search when URL has a query parameter
  React.useEffect(() => {
    if (!router.isReady) return;

    const urlQuery = router.query.q;

    if (typeof urlQuery === "string" && urlQuery.trim()) {
      setQuery(urlQuery);
      void handleSearch(undefined, urlQuery, {
        skipRouting: true,
        skipIntentCheck: true,
      });
    }
  }, [router.isReady, router.query.q]);

  type SongResponsePayload = {
    intent: "song";
    mode: "canonical" | "ambiguous";
    results: SongResult[];
    error?: string;
    debugInfo?: unknown;
  };

  type ContributorResponsePayload = {
    intent: "contributor";
    mode: "ambiguous";
    results: ContributorResult[];
    error?: string;
  };

  type SearchResponsePayload = SongResponsePayload | ContributorResponsePayload;

  async function handleSearch(
    e?: React.FormEvent,
    searchQuery?: string,
    options?: { skipRouting?: boolean; skipIntentCheck?: boolean },
  ) {
    if (e) e.preventDefault();

    const queryToSearch = (searchQuery ?? query).trim();
    if (!queryToSearch) return;

    // Abort any in-progress search
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    abortControllerRef.current = new AbortController();
    setError(null);
    setRecordingResults([]);
    setContributorResults([]);
    setIntent(null);
    setMode(null);
    setLoading(true);

    // 20-second timeout for the search
    let timedOut = false;
    const timeoutId = setTimeout(() => {
      timedOut = true;
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    }, 20000);

    try {
      if (!options?.skipIntentCheck) {
        const intentParams = new URLSearchParams({ q: queryToSearch });
        const intentRes = await fetch(
          `/api/intent-search?${intentParams.toString()}`,
          { signal: abortControllerRef.current.signal },
        );

        const intentData = (await intentRes.json()) as IntentSearchResponse & {
          error?: string;
        };
        if (!intentRes.ok || intentData.error) {
          throw new Error(intentData.error ?? "Intent search failed");
        }

        if (intentData.intent === "recording") {
          saveRecentSearch(queryToSearch);
          setRecentSearches(getRecentSearches());
          await router.push(`/recording/${intentData.recordingId}`);
          return;
        }

        if (intentData.intent === "contributor") {
          saveRecentSearch(queryToSearch);
          setRecentSearches(getRecentSearches());
          const contributorName =
            intentData.contributorName ?? queryToSearch;
          const params = new URLSearchParams({
            mbid: intentData.contributorId,
            name: contributorName,
          });
          await router.push(
            `/contributor/${encodeURIComponent(contributorName)}?${params.toString()}`,
          );
          return;
        }
      }

      const params = new URLSearchParams({
        q: queryToSearch,
      });

      const res = await fetch(`/api/search?${params.toString()}`, {
        signal: abortControllerRef.current.signal,
      });

      const data = (await res.json()) as SearchResponsePayload;
      if (data.error) {
        throw new Error(data.error);
      }

      // Save to recent searches
      saveRecentSearch(queryToSearch);
      setRecentSearches(getRecentSearches());

      if (data.intent === "song") {
        setIntent("song");
        setMode(data.mode);
        setRecordingResults(data.results);
        setContributorResults([]);
      } else {
        setIntent("contributor");
        setMode(data.mode);
        setContributorResults(data.results);
        setRecordingResults([]);
      }

      if (!options?.skipRouting) {
        const currentQuery =
          typeof router.query.q === "string" ? router.query.q : "";
        if (router.pathname !== "/search" || currentQuery !== queryToSearch) {
          await router.push(
            {
              pathname: "/search",
              query: { q: queryToSearch },
            },
            undefined,
            { shallow: true },
          );
        }
      }
    } catch (err) {
      // Don't show error if the request was aborted by user (not timeout)
      if (err instanceof Error && err.name === "AbortError") {
        if (timedOut) {
          setError("Search timed out after 20 seconds. Please try again.");
        }
        return;
      }
      setError(err instanceof Error ? err.message : "Search failed");
    } finally {
      clearTimeout(timeoutId);
      setLoading(false);
    }
  }

  async function handleSelect(item: SongResult) {
    setError(null);
    await router.push({
      pathname: `/recording/${item.recordingMBID}`,
    });
  }

  async function handleContributorNavigate(contributor: ContributorResult) {
    await router.push(
      `/contributor/${encodeURIComponent(contributor.artistName)}?${new URLSearchParams(
        { mbid: contributor.artistMBID, name: contributor.artistName },
      ).toString()}`,
    );
  }

  const hasResults =
    intent === "song"
      ? recordingResults.length > 0
      : intent === "contributor"
        ? contributorResults.length > 0
        : false;

  return (
    <AppLayout>
      <div className="space-y-6">
        <section className={cn(surface.cardPadded, "space-y-4")}>
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-2">
              <h1 className={text.pageTitle}>Search</h1>
              <p className={text.meta}>
                Search a song or artist/musician/contributer (e.g. "Jump", "Nile
                Rogers", etc)
              </p>
            </div>

            <div
              className={cn(
                "relative h-12 w-12 shrink-0 rounded-full border-2 border-border bg-secondary",
                "grid place-items-center",
              )}
              aria-hidden="true"
            >
              <div className="h-7 w-7 rounded-full border-2 border-border bg-card" />
              <div className="absolute h-2 w-2 rounded-full bg-accent" />
            </div>
          </div>

          <form
            onSubmit={handleSearch}
            className="flex flex-col gap-2 sm:flex-row"
          >
            <div className="relative w-full">
              <Input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search for a song or contributor…"
                className={cn("h-11 pr-10", "w-full")}
              />
              {query.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    // Abort any in-progress search
                    if (abortControllerRef.current) {
                      abortControllerRef.current.abort();
                    }
                    setQuery("");
                    setRecordingResults([]);
                    setContributorResults([]);
                    setIntent(null);
                    setMode(null);
                    setError(null);
                    setLoading(false);
                    inputRef.current?.focus();
                  }}
                  className={cn(
                    "absolute right-2 top-1/2 -translate-y-1/2",
                    "grid h-8 w-8 place-items-center rounded-md",
                    "text-muted-foreground hover:text-foreground",
                    "hover:bg-secondary/50",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  )}
                  aria-label="Clear search"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
            <Button
              type="submit"
              disabled={loading || query.trim().length === 0}
              className="h-11"
            >
              {loading ? (
                <span className="inline-flex items-center gap-2">
                  <RecordSpinner
                    size={20}
                    label=""
                    showTonearm
                    className="opacity-95"
                  />
                  Searching…
                </span>
              ) : (
                "Search"
              )}
            </Button>
          </form>

          {loading ? (
            <div className="pt-2">
              <div className="flex flex-col items-center justify-center gap-3">
                <RecordSpinner size={72} showTonearm className="opacity-95" />
                <div className={text.meta}>Searching…</div>
              </div>
            </div>
          ) : null}

          {/* Recent Searches */}
          {!loading && !query && recentSearches.length > 0 && (
            <div className="space-y-3 pt-2">
              <div className={cn(text.meta, "flex items-center gap-2")}>
                <Clock className="h-4 w-4" />
                Recent searches
              </div>
              <div className="flex flex-wrap gap-2">
                {recentSearches.map((recentQuery) => (
                  <button
                    key={recentQuery}
                    type="button"
                    onClick={() => {
                      setQuery(recentQuery);
                      void handleSearch(undefined, recentQuery);
                    }}
                    className={cn(
                      surface.badge,
                      "cursor-pointer transition-colors hover:bg-secondary",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    )}
                  >
                    {recentQuery}
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>

        {error && <div className="text-sm text-destructive">{error}</div>}

        {/* No Results Message */}
        {!loading && !error && query && intent && !hasResults && (
          <div className={cn(surface.cardPadded, "text-center space-y-2")}>
            <div className={text.body}>No results found for "{query}"</div>
            <div className={text.meta}>
              Try different keywords or check your spelling
            </div>
          </div>
        )}

        {hasResults && (
          <div className="space-y-6">
            {recordingResults.length > 0 && (
              <div className="space-y-3">
                <div className={text.sectionTitle}>Recordings</div>

                <div className="space-y-3">
                  {recordingResults.map((item) => (
                    <button
                      key={item.recordingMBID}
                      type="button"
                      onClick={() => void handleSelect(item)}
                      className={cn(
                        surface.cardPadded,
                        "w-full text-left transition-colors",
                        "hover:bg-secondary/60",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      )}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="font-semibold">{item.title}</div>
                          <div
                            className={cn(
                              text.body,
                              "truncate text-muted-foreground",
                            )}
                            title={item.artist}
                          >
                            {item.artist}
                          </div>
                        </div>

                        <div className="flex shrink-0 flex-nowrap items-start justify-end gap-2">
                          {item.year ? (
                            <span className={surface.badge}>{item.year}</span>
                          ) : null}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {contributorResults.length > 0 && (
              <div className="space-y-3">
                <div className={text.sectionTitle}>Contributors</div>
                <div className="space-y-3">
                  {contributorResults.map((contributor) => (
                    <button
                      key={contributor.artistMBID}
                      type="button"
                      onClick={() => void handleContributorNavigate(contributor)}
                      className={cn(
                        surface.cardPadded,
                        "w-full text-left transition-colors",
                        "hover:bg-secondary/60",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      )}
                    >
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="text-lg font-semibold">
                            {contributor.artistName}
                          </div>
                          {contributor.area ? (
                            <span className={cn(text.meta, "text-muted-foreground")}>
                              {contributor.area}
                            </span>
                          ) : null}
                        </div>
                        {contributor.primaryRoles && contributor.primaryRoles.length > 0 ? (
                          <div className={cn(text.meta, "text-muted-foreground")}>
                            Roles: {contributor.primaryRoles.join(", ")}
                          </div>
                        ) : (
                          <div className={cn(text.meta, "text-muted-foreground")}>
                            Roles: —
                          </div>
                        )}
                        <div className="text-xs text-muted-foreground">
                          MBID: {contributor.artistMBID}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
