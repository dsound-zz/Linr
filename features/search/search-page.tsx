import * as React from "react";
import { useRouter } from "next/router";

import type { SearchResultItem } from "@/lib/types";
import { AppLayout } from "@components/layout/app-layout";
import { Button } from "@components/ui/button";
import { Input } from "@components/ui/input";

export function SearchPage() {
  const router = useRouter();

  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<SearchResultItem[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [debug, setDebug] = React.useState(false);

  async function handleSearch(e?: React.FormEvent) {
    if (e) e.preventDefault();
    setError(null);
    setResults([]);
    setLoading(true);

    try {
      const params = new URLSearchParams({
        q: query,
        ...(debug ? { debug: "1" } : {}),
      });

      const res = await fetch(`/api/search?${params.toString()}`);
      const data = (await res.json()) as {
        results?: SearchResultItem[];
        error?: string;
      };

      if (data.error) throw new Error(data.error);

      setResults(Array.isArray(data.results) ? data.results : []);
    } catch (err) {
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
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">Search</h1>
          <p className="text-sm text-muted-foreground">
            Tip: Add an artist with “by” or “-” for tighter matches (e.g. “Jump
            by Van Halen”).
          </p>
        </div>

        <div className="space-y-3">
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={debug}
              onChange={(e) => setDebug(e.target.checked)}
            />
            Debug
          </label>

          <form onSubmit={handleSearch} className="flex gap-2">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search for a song…"
            />
            <Button
              type="submit"
              disabled={loading || query.trim().length === 0}
            >
              {loading ? "Searching…" : "Search"}
            </Button>
          </form>
        </div>

        {error && <div className="text-sm text-destructive">{error}</div>}

        {results.length > 0 && (
          <div className="space-y-3">
            <h2 className="text-sm font-medium text-muted-foreground">
              Results
            </h2>

            <div className="divide-y divide-border rounded-lg border border-border">
              {results.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => void handleSelect(item)}
                  className="w-full px-4 py-3 text-left transition-colors hover:bg-accent"
                >
                  <div className="font-medium">{item.title}</div>
                  <div className="text-sm text-muted-foreground">
                    {item.artist}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    {item.year ? <span>{item.year}</span> : null}
                    {item.source ? <span>source: {item.source}</span> : null}
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
