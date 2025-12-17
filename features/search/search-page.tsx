import * as React from "react";
import { useRouter } from "next/router";
import { X } from "lucide-react";

import type { SearchResultItem } from "@/lib/types";
import { cn } from "@/lib/utils";
import { AppLayout } from "@components/layout/app-layout";
import { RecordSpinner } from "@components/record-spinner";
import { Button } from "@components/ui/button";
import { Input } from "@components/ui/input";
import { surface, text } from "@styles/typeography";

export function SearchPage() {
  const router = useRouter();

  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<SearchResultItem[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const abortControllerRef = React.useRef<AbortController | null>(null);

  // Auto-search when URL has a query parameter
  React.useEffect(() => {
    if (!router.isReady) return;

    const urlQuery = router.query.q;
    const autoNavigate = router.query.auto === '1';

    if (typeof urlQuery === 'string' && urlQuery.trim()) {
      setQuery(urlQuery);
      handleSearch(undefined, urlQuery, autoNavigate);
    }
  }, [router.isReady, router.query.q, router.query.auto]);

  async function handleSearch(e?: React.FormEvent, searchQuery?: string, autoNavigate?: boolean) {
    if (e) e.preventDefault();

    const queryToSearch = searchQuery ?? query;
    if (!queryToSearch.trim()) return;

    // Abort any in-progress search
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    abortControllerRef.current = new AbortController();
    setError(null);
    setResults([]);
    setLoading(true);

    try {
      const params = new URLSearchParams({
        q: queryToSearch,
      });

      const res = await fetch(`/api/search?${params.toString()}`, {
        signal: abortControllerRef.current.signal,
      });
      const data = (await res.json()) as {
        results?: SearchResultItem[];
        error?: string;
      };

      if (data.error) throw new Error(data.error);

      const searchResults = Array.isArray(data.results) ? data.results : [];
      setResults(searchResults);

      // If autoNavigate is enabled and we have exactly one result, navigate to it
      if (autoNavigate && searchResults.length === 1) {
        const firstResult = searchResults[0];
        await handleSelect(firstResult);
      }
    } catch (err) {
      // Don't show error if the request was aborted
      if (err instanceof Error && err.name === "AbortError") {
        return;
      }
      setError(err instanceof Error ? err.message : "Search failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleSelect(item: SearchResultItem) {
    setError(null);

    // Only allow lookup for MusicBrainz sources.
    if (item.source && item.source !== "musicbrainz") {
      setError(
        `Lookup is not supported for ${item.source} sources. Only MusicBrainz results can be looked up.`,
      );
      return;
    }

    if (item.id.startsWith("wiki:")) {
      setError(
        "Wikipedia results do not support MusicBrainz lookup. Only MusicBrainz results can be looked up.",
      );
      return;
    }

    await router.push({
      pathname: `/recording/${item.id}`,
      query: item.source ? { source: item.source } : undefined,
    });
  }

  return (
    <AppLayout>
      <div className="space-y-6">
        <section className={cn(surface.cardPadded, "space-y-4")}>
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-2">
              <h1 className={text.pageTitle}>Search</h1>
              <p className={text.meta}>
                Tip: Add an artist with “by” or “-” for tighter matches (e.g.
                “Jump by Van Halen”).
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
                placeholder="Search for a song…"
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
                    setResults([]);
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
        </section>

        {error && <div className="text-sm text-destructive">{error}</div>}

        {results.length > 0 && (
          <div className="space-y-3">
            <div className={text.sectionTitle}>Results</div>

            <div className="space-y-3">
              {results.map((item) => (
                <button
                  key={item.id}
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
                      {item.source ? (
                        <span className={surface.sticker}>
                          <span className="hidden sm:inline">source: </span>
                          {item.source}
                        </span>
                      ) : null}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
