"use client";

import { useState } from "react";
import type { SearchResultItem, NormalizedRecording } from "@/lib/types";

export default function HomePage() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResultItem[]>([]);
  const [selected, setSelected] = useState<NormalizedRecording | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [debug, setDebug] = useState(false);

  async function handleSearch(e?: React.FormEvent) {
    if (e) e.preventDefault();
    setError("");
    setSelected(null);
    setResults([]);
    setLoading(true);

    try {
      const params = new URLSearchParams({
        q: query,
        ...(debug ? { debug: "1" } : {}),
      });

      const res = await fetch(`/api/search?${params.toString()}`);
      const data = await res.json();

      console.log("[FRONTEND] Received response:", data);
      console.log("[FRONTEND] data.results:", data.results);

      if (data.debugInfo) {
        console.log(
          "[FRONTEND] Debug info:",
          JSON.stringify(data.debugInfo, null, 2),
        );
      }

      if (data.error) throw new Error(data.error);

      // Handle both response formats: { results: [...] } or { result: ... }
      const resultsArray = data.results || (data.result ? [data.result] : []);
      console.log("[FRONTEND] Results array:", resultsArray);
      console.log("[FRONTEND] Results array length:", resultsArray.length);

      setResults(resultsArray);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleSelect(item: SearchResultItem) {
    // Temporary debug logging
    console.log("[LOOKUP] Attempting lookup:", {
      id: item.id,
      source: item.source,
    });

    // Only allow lookup for MusicBrainz sources
    if (item.source && item.source !== "musicbrainz") {
      setError(
        `Lookup is not supported for ${item.source} sources. Only MusicBrainz results can be looked up.`,
      );
      return;
    }

    // Also check ID prefix as a safety guard
    if (item.id.startsWith("wiki:")) {
      setError(
        "Wikipedia results do not support MusicBrainz lookup. Only MusicBrainz results can be looked up.",
      );
      return;
    }

    setLoading(true);
    setError("");

    try {
      const params = new URLSearchParams({
        id: item.id,
        ...(item.source ? { source: item.source } : {}),
      });
      const res = await fetch(`/api/recording?${params.toString()}`);
      const data = await res.json();

      if (data.error) throw new Error(data.error);

      setSelected(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load recording");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-xl mx-auto pt-20 px-4">
      <h1 className="text-3xl font-bold mb-6 text-center">Linr</h1>

      {/* Search Bar */}
      <div className="flex flex-col mb-6">
        <label className="flex items-center gap-2 text-sm text-gray-500">
          <input
            type="checkbox"
            checked={debug}
            onChange={(e) => setDebug(e.target.checked)}
          />
          Debug
        </label>
        <form onSubmit={handleSearch} className="flex gap-2 mb-2">
          <input
            type="text"
            placeholder="Search for a song..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="flex-1 px-4 py-2 border rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            type="submit"
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
          >
            Search
          </button>
        </form>
        <p className="text-xs text-gray-500 mt-2">
          Tip: Add an artist with &quot;by&quot; or &quot;-&quot; for tighter
          matches (e.g. &quot;Jump by Van Halen&quot;)
        </p>
      </div>

      {/* Loading */}
      {loading && <p className="text-center text-gray-500">Loading...</p>}

      {/* Error */}
      {error && <p className="text-red-600 text-center mb-4">{error}</p>}

      {/* Search Results */}
      {!selected && results?.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold">
            {results.length === 1
              ? "1 recording found:"
              : "Select a recording:"}
          </h2>

          {results.map((item) => {
            return (
              <button
                key={item.id}
                onClick={() => handleSelect(item)}
                className="w-full text-left border p-3 rounded-md hover:bg-gray-50"
              >
                <div className="font-semibold">{item.title}</div>
                <div className="text-gray-600">{item.artist}</div>
                {item.year && (
                  <div className="text-gray-400 text-sm">
                    Released {item.year}
                  </div>
                )}
                {item.source && (
                  <div className="text-gray-400 text-xs mt-1">
                    Source: {item.source}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Selected Recording */}
      {selected && (
        <div className="mt-8 border rounded-md p-4 space-y-2">
          <h2 className="text-xl font-semibold">{selected.title}</h2>
          <p className="text-gray-600">{selected.artist}</p>

          <div className="text-gray-500 text-sm">
            {selected.release?.title} — {selected.release?.date}
          </div>

          <h3 className="font-semibold mt-4">Selected Recording</h3>
          <pre className="bg-gray-100 p-3 rounded-md text-black text-sm overflow-x-auto">
            {JSON.stringify(selected, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
