import { describe, it, expect, beforeEach, vi } from "vitest";

import type { SearchResponse, CanonicalResult } from "@/lib/search/types";
import type { ContributorIntentResult } from "@/lib/search/intentTypes";

const mockSearchCanonicalSong = vi.hoisted(() => vi.fn());
const mockSearchContributorIntent = vi.hoisted(() => vi.fn());

vi.mock("@/lib/search", () => ({
  searchCanonicalSong: (query: string) => mockSearchCanonicalSong(query),
}));

vi.mock("@/lib/search/searchContributorIntent", () => ({
  searchContributorIntent: (query: string) =>
    mockSearchContributorIntent(query),
}));

// eslint-disable-next-line import/first
import { GET } from "./route";

function makeCanonicalResult(
  overrides: Partial<CanonicalResult> = {},
): CanonicalResult {
  return {
    id: "rec-default",
    title: "Default Song",
    artist: "Default Artist",
    year: "1980",
    releaseTitle: "Default",
    entityType: "recording",
    confidenceScore: 90,
    source: "musicbrainz",
    ...overrides,
  };
}

describe("GET /api/intent-search", () => {
  beforeEach(() => {
    mockSearchCanonicalSong.mockReset();
    mockSearchContributorIntent.mockReset();
  });

  it("returns ambiguous intent for Jump", async () => {
    const response: SearchResponse = {
      mode: "ambiguous",
      results: [
        makeCanonicalResult({ id: "jump-van-halen", title: "Jump", confidenceScore: 88 }),
        makeCanonicalResult({ id: "jump-kris-kross", title: "Jump", artist: "Kris Kross", confidenceScore: 82 }),
      ],
    };
    const contributors: ContributorIntentResult = { candidates: [] };
    mockSearchCanonicalSong.mockResolvedValue(response);
    mockSearchContributorIntent.mockResolvedValue(contributors);

    const res = await GET(new Request("http://localhost/api/intent-search?q=Jump"));
    const json = (await res.json()) as Record<string, unknown>;

    expect(json.intent).toBe("ambiguous");
    expect(Array.isArray(json.recordings)).toBe(true);
    expect((json.recordings as unknown[]).length).toBe(2);
    expect(Array.isArray(json.contributors)).toBe(true);
    expect((json.contributors as unknown[]).length).toBe(0);
  });

  it("routes Jump Van Halen directly to recording", async () => {
    const response: SearchResponse = {
      mode: "canonical",
      result: makeCanonicalResult({
        id: "jump-van-halen",
        title: "Jump",
        artist: "Van Halen",
        confidenceScore: 97,
      }),
    };
    mockSearchCanonicalSong.mockResolvedValue(response);
    mockSearchContributorIntent.mockResolvedValue({ candidates: [] });

    const res = await GET(
      new Request("http://localhost/api/intent-search?q=Jump%20Van%20Halen"),
    );
    const json = (await res.json()) as Record<string, unknown>;

    expect(json.intent).toBe("recording");
    expect(json.recordingId).toBe("jump-van-halen");
  });

  it("routes Max Martin to contributor intent", async () => {
    mockSearchCanonicalSong.mockResolvedValue<SearchResponse>({
      mode: "ambiguous",
      results: [],
    });
    mockSearchContributorIntent.mockResolvedValue({
      candidates: [
        {
          id: "max-martin",
          name: "Max Martin",
          disambiguation: null,
          score: 0.91,
        },
      ],
    });

    const res = await GET(
      new Request("http://localhost/api/intent-search?q=Max%20Martin"),
    );
    const json = (await res.json()) as Record<string, unknown>;

    expect(json.intent).toBe("contributor");
    expect(json.contributorId).toBe("max-martin");
    expect(json.contributorName).toBe("Max Martin");
  });

  it("keeps The Dude ambiguous when multiple contributors exist", async () => {
    mockSearchCanonicalSong.mockResolvedValue<SearchResponse>({
      mode: "ambiguous",
      results: [],
    });
    mockSearchContributorIntent.mockResolvedValue({
      candidates: [
        { id: "artist-1", name: "The Dude", disambiguation: null, score: 0.86 },
        { id: "artist-2", name: "The Dude", disambiguation: "Producer", score: 0.82 },
      ],
    });

    const res = await GET(
      new Request("http://localhost/api/intent-search?q=The%20Dude"),
    );
    const json = (await res.json()) as Record<string, unknown>;

    expect(json.intent).toBe("ambiguous");
    expect((json.contributors as unknown[]).length).toBe(2);
  });

  it("lets recordings win for The Dude Quincy Jones", async () => {
    mockSearchCanonicalSong.mockResolvedValue<SearchResponse>({
      mode: "canonical",
      result: makeCanonicalResult({
        id: "the-dude-quincy",
        title: "The Dude",
        artist: "Quincy Jones",
        confidenceScore: 96,
      }),
    });
    mockSearchContributorIntent.mockResolvedValue({
      candidates: [
        { id: "artist-1", name: "Quincy Jones", disambiguation: null, score: 0.78 },
      ],
    });

    const res = await GET(
      new Request("http://localhost/api/intent-search?q=The%20Dude%20Quincy%20Jones"),
    );
    const json = (await res.json()) as Record<string, unknown>;

    expect(json.intent).toBe("recording");
    expect(json.recordingId).toBe("the-dude-quincy");
  });

  it("treats Aja as ambiguous when confidence is low", async () => {
    mockSearchCanonicalSong.mockResolvedValue<SearchResponse>({
      mode: "canonical",
      result: makeCanonicalResult({
        id: "aja-steely-dan",
        title: "Aja",
        artist: "Steely Dan",
        confidenceScore: 85,
      }),
    });
    mockSearchContributorIntent.mockResolvedValue({ candidates: [] });

    const res = await GET(new Request("http://localhost/api/intent-search?q=Aja"));
    const json = (await res.json()) as Record<string, unknown>;

    expect(json.intent).toBe("ambiguous");
    expect((json.recordings as unknown[]).length).toBe(1);
  });
});
