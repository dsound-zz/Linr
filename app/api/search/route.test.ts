import { describe, it, expect, beforeEach, vi } from "vitest";

import type { ContributorSearchResult } from "@/lib/types";
import type { SearchResponse, CanonicalResult } from "@/lib/search/types";

const mockInferSearchIntent = vi.hoisted(() => vi.fn());
const mockSearchCanonicalSong = vi.hoisted(() => vi.fn());
const mockSearchContributorsByName = vi.hoisted(() => vi.fn());
const mockLogSearchQuery = vi.hoisted(() => vi.fn());

vi.mock("@/lib/search/inferIntent", () => ({
  inferSearchIntent: (query: string) => mockInferSearchIntent(query),
}));

vi.mock("@/lib/search/searchContributors", () => ({
  searchContributorsByName: (query: string) =>
    mockSearchContributorsByName(query),
}));

vi.mock("@/lib/search", () => ({
  searchCanonicalSong: (query: string, debug?: boolean) =>
    mockSearchCanonicalSong(query, debug),
}));

vi.mock("@/lib/logger", () => ({
  logSearchQuery: (...args: unknown[]) => mockLogSearchQuery(...args),
}));

// eslint-disable-next-line import/first
import { GET } from "./route";

function makeCanonicalResult(
  overrides: Partial<CanonicalResult> = {},
): CanonicalResult {
  return {
    id: "rec-1",
    title: "Default",
    artist: "Artist",
    year: "1980",
    releaseTitle: "Album",
    entityType: "recording",
    confidenceScore: 90,
    source: "musicbrainz",
    ...overrides,
  };
}

describe("GET /api/search", () => {
  beforeEach(() => {
    mockInferSearchIntent.mockReset();
    mockSearchCanonicalSong.mockReset();
    mockSearchContributorsByName.mockReset();
    mockLogSearchQuery.mockReset();
  });

  it("returns contributor-only results when intent is contributor", async () => {
    const contributorMatches: ContributorSearchResult[] = [
      {
        artistMBID: "max-martin",
        name: "Max Martin",
        roles: ["Producer"],
        knownFor: [],
        area: "Sweden",
      },
    ];
    mockInferSearchIntent.mockResolvedValue({
      intent: { type: "contributor", name: "Max Martin" },
      contributorMatches,
    });

    const res = await GET(
      new Request("http://localhost/api/search?q=Max%20Martin"),
    );
    const json = (await res.json()) as Record<string, unknown>;

    expect(json.intent).toBe("contributor");
    expect(json.mode).toBe("ambiguous");
    const results = json.results as Array<Record<string, unknown>>;
    expect(results).toHaveLength(1);
    expect(results[0]?.entityType).toBe("contributor");
    expect(results[0]?.artistMBID).toBe("max-martin");
    expect(mockSearchCanonicalSong).not.toHaveBeenCalled();
  });

  it("filters to allowed song entity types for canonical responses", async () => {
    mockInferSearchIntent.mockResolvedValue({
      intent: { type: "song", title: "Jump", artist: null },
      contributorMatches: [],
    });
    const canonical: SearchResponse = {
      mode: "canonical",
      result: makeCanonicalResult({ entityType: "song_inferred" }),
    };
    mockSearchCanonicalSong.mockResolvedValue(canonical);

    const res = await GET(
      new Request("http://localhost/api/search?q=Jump"),
    );
    const json = (await res.json()) as Record<string, unknown>;

    expect(json.intent).toBe("song");
    expect(json.mode).toBe("ambiguous");
    expect((json.results as unknown[]).length).toBe(0);
  });

  it("keeps only recording and album_track entities for ambiguous responses", async () => {
    mockInferSearchIntent.mockResolvedValue({
      intent: { type: "song", title: "Jump", artist: null },
      contributorMatches: [],
    });
    mockSearchCanonicalSong.mockResolvedValue<SearchResponse>({
      mode: "ambiguous",
      results: [
        makeCanonicalResult({ id: "rec", entityType: "recording" }),
        makeCanonicalResult({ id: "track", entityType: "album_track" }),
        makeCanonicalResult({ id: "song", entityType: "song_inferred" }),
      ],
    });

    const res = await GET(
      new Request("http://localhost/api/search?q=Jump"),
    );
    const json = (await res.json()) as Record<string, unknown>;

    expect(json.intent).toBe("song");
    const results = json.results as Array<{ entityType: string }>;
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.entityType === "recording" || r.entityType === "album_track")).toBe(
      true,
    );
  });

  it("includes debug info when debug=1 is passed", async () => {
    mockInferSearchIntent.mockResolvedValue({
      intent: { type: "song", title: "Jump", artist: null },
      contributorMatches: [],
    });
    const response: SearchResponse = {
      mode: "ambiguous",
      results: [makeCanonicalResult()],
    };
    const debugInfo = { stages: { mock: true } };
    mockSearchCanonicalSong.mockResolvedValue({ response, debugInfo });

    const res = await GET(
      new Request("http://localhost/api/search?q=Jump&debug=1"),
    );
    const json = (await res.json()) as Record<string, unknown>;

    expect(json.intent).toBe("song");
    expect(json.debugInfo).toEqual(debugInfo);
    expect(mockLogSearchQuery).toHaveBeenCalledWith({
      query: "Jump",
      response,
      debugInfo,
    });
  });
});
