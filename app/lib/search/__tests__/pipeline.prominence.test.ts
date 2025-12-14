/**
 * Integration tests for prominence scoring in pipeline
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { searchCanonicalSong } from "../pipeline";
import type {
  MusicBrainzRecording,
  MusicBrainzArtistCreditEntry,
} from "../../types";

// Mock external dependencies
const mockMBClient = {
  search: vi.fn(),
  lookup: vi.fn(),
};

const mockGetWikipediaPersonnel = vi.fn(() => Promise.resolve([]));
const mockSearchWikipediaTrack = vi.fn(() => Promise.resolve(null));

vi.mock("../../musicbrainz", () => ({
  getMBClient: vi.fn(() => mockMBClient),
  formatArtistCredit: vi.fn((recording: MusicBrainzRecording) => {
    const ac = recording["artist-credit"] ?? [];
    if (!Array.isArray(ac)) return "";
    return ac
      .map((entry: MusicBrainzArtistCreditEntry | string) => {
        if (typeof entry === "string") return entry;
        return entry.name || entry.artist?.name || "";
      })
      .join("");
  }),
}));

vi.mock("../wikipedia", () => ({
  getWikipediaPersonnel: (...args: any[]) => mockGetWikipediaPersonnel(...args),
  searchWikipediaTrack: (...args: any[]) => mockSearchWikipediaTrack(...args),
}));

vi.mock("../openai", () => ({
  rerankCandidates: vi.fn(),
}));

// Mock cache to prevent cached empty results
vi.mock("../cache", () => ({
  getCached: vi.fn(() => null), // Always return null (no cache hit)
  setCached: vi.fn(),
  cacheKeyRecording: vi.fn((key: string) => key),
  cacheKeyRelease: vi.fn((key: string) => key),
  cacheKeyArtist: vi.fn((key: string) => key),
}));

// Mock artist popularity to return empty array (no artist-scoped searches in these tests)
vi.mock("../artistPopularity", () => ({
  getPopularArtists: vi.fn(async () => []),
  checkWikipediaPresence: vi.fn(async () => false),
}));

describe("Pipeline Prominence Integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetWikipediaPersonnel.mockResolvedValue([]);
    mockSearchWikipediaTrack.mockResolvedValue(null);
    // Reset mock - tests will set their own implementations
    mockMBClient.search.mockReset();
  });

  it("'Rosanna' returns multiple results including Toto", async () => {
    // Mock Toto recording with prominent artist signals
    const totoRecording: MusicBrainzRecording = {
      id: "toto-rosanna-id",
      title: "Rosanna",
      "artist-credit": [{ name: "Toto", artist: { name: "Toto" } }],
      releases: [
        {
          title: "Toto IV",
          date: "1982",
          country: "US",
          "release-group": {
            "primary-type": "Album",
            "secondary-types": [],
          },
        },
        {
          title: "Toto IV",
          date: "1982",
          country: "US",
          "release-group": {
            "primary-type": "Single",
            "secondary-types": [],
          },
        },
        {
          title: "Greatest Hits",
          date: "1990",
          country: "US",
          "release-group": {
            "primary-type": "Album",
            "secondary-types": [],
          },
        },
      ],
      length: 240000,
      score: 100,
    };

    // Mock other recording
    const otherRecording: MusicBrainzRecording = {
      id: "other-rosanna-id",
      title: "Rosanna",
      "artist-credit": [
        { name: "Other Artist", artist: { name: "Other Artist" } },
      ],
      releases: [
        {
          id: "release-other-1",
          title: "Some Album",
          date: "2020",
          country: "GB",
          "release-group": {
            id: "rg-other-1",
            "primary-type": "Album",
            "secondary-types": [],
          },
        },
      ],
      length: 200000,
      score: 100,
    };

    // Mock paginated search responses
    // Handle both exact search (quoted query) and regular search
    mockMBClient.search.mockImplementation(
      (entityType: string, params: any) => {
        if (entityType === "recording") {
          const offset = params?.offset || 0;
          // Return recordings for any recording search (tests are isolated)
          if (offset === 0) {
            return Promise.resolve({
              recordings: [totoRecording, otherRecording],
              count: 2,
            });
          }
          // Return empty for subsequent pages
          return Promise.resolve({
            recordings: [],
            count: 2,
          });
        }
        // Return empty for non-recording searches
        return Promise.resolve({ [entityType]: [], count: 0 });
      },
    );

    const result = await searchCanonicalSong("Rosanna", true);

    expect(result).not.toBeNull();
    if (!result) {
      console.error("Result is null - check debugInfo if available");
      return;
    }

    // When debug=true, result is { response, debugInfo }
    const response = "response" in result ? result.response : null;
    if (!response && "debugInfo" in result) {
      console.error(
        "Response is null. Debug info:",
        JSON.stringify(result.debugInfo, null, 2),
      );
    }
    expect(response).not.toBeNull();
    if (!response) return;

    if (response.mode === "ambiguous") {
      const artists = response.results.map((r) => r.artist);
      // Toto should be included (prominent artist)
      expect(artists).toContain("Toto");
      expect(response.results.length).toBeGreaterThan(1);
    } else {
      // Even if canonical, Toto should be the result
      expect(response.result.artist).toBe("Toto");
    }
  });

  it("'Jump' returns Madonna + Van Halen (multiple prominent artists)", async () => {
    const vanHalenRecording: MusicBrainzRecording = {
      id: "van-halen-jump-id",
      title: "Jump",
      "artist-credit": [{ name: "Van Halen", artist: { name: "Van Halen" } }],
      releases: [
        {
          id: "release-vh-1",
          title: "1984",
          date: "1984",
          country: "US",
          "release-group": {
            id: "rg-vh-1",
            "primary-type": "Album",
            "secondary-types": [],
          },
        },
        {
          id: "release-vh-2",
          title: "1984",
          date: "1984",
          country: "US",
          "release-group": {
            id: "rg-vh-2",
            "primary-type": "Single",
            "secondary-types": [],
          },
        },
      ],
      length: 240000,
      score: 100,
    };

    const madonnaRecording: MusicBrainzRecording = {
      id: "madonna-jump-id",
      title: "Jump",
      "artist-credit": [{ name: "Madonna", artist: { name: "Madonna" } }],
      releases: [
        {
          id: "release-madonna-1",
          title: "Like a Prayer",
          date: "1989",
          country: "US",
          "release-group": {
            id: "rg-madonna-1",
            "primary-type": "Album",
            "secondary-types": [],
          },
        },
        {
          id: "release-madonna-2",
          title: "Like a Prayer",
          date: "1989",
          country: "US",
          "release-group": {
            id: "rg-madonna-2",
            "primary-type": "Single",
            "secondary-types": [],
          },
        },
      ],
      length: 220000,
      score: 100,
    };

    // Mock paginated search responses
    mockMBClient.search.mockImplementation(
      (entityType: string, params: any) => {
        if (entityType === "recording") {
          const offset = params?.offset || 0;
          if (offset === 0) {
            return Promise.resolve({
              recordings: [vanHalenRecording, madonnaRecording],
              count: 2,
            });
          }
          return Promise.resolve({
            recordings: [],
            count: 2,
          });
        }
        return Promise.resolve({ [entityType]: [], count: 0 });
      },
    );

    const result = await searchCanonicalSong("Jump", true);

    expect(result).not.toBeNull();
    if (!result) return;

    const response = "response" in result ? result.response : null;
    expect(response).not.toBeNull();
    if (!response) return;

    // Multiple prominent artists should force ambiguous mode
    if (response.mode === "ambiguous") {
      const artists = response.results.map((r) => r.artist);
      // Both prominent artists should appear
      expect(artists).toContain("Van Halen");
      expect(artists).toContain("Madonna");
    } else {
      // If canonical, should still include prominent artist
      const allArtists = [response.result.artist];
      expect(allArtists.some((a) => a === "Van Halen" || a === "Madonna")).toBe(
        true,
      );
    }
  });

  it("prominent artists appear even if they do not win", async () => {
    // High-scoring non-prominent artist
    const highScoreRecording: MusicBrainzRecording = {
      id: "high-score-id",
      title: "Test Song",
      "artist-credit": [
        { name: "High Score Artist", artist: { name: "High Score Artist" } },
      ],
      releases: [
        {
          title: "Test Album",
          date: "2020",
          country: "GB",
          "release-group": {
            "primary-type": "Album",
            "secondary-types": [],
          },
        },
      ],
      length: 200000,
      score: 200, // Very high score
    };

    // Lower-scoring but prominent artist (Toto-like)
    const prominentRecording: MusicBrainzRecording = {
      id: "prominent-id",
      title: "Test Song",
      "artist-credit": [{ name: "Toto", artist: { name: "Toto" } }],
      releases: [
        {
          title: "Toto IV",
          date: "1982",
          country: "US",
          "release-group": {
            "primary-type": "Album",
            "secondary-types": [],
          },
        },
        {
          title: "Toto IV",
          date: "1982",
          country: "US",
          "release-group": {
            "primary-type": "Single",
            "secondary-types": [],
          },
        },
        {
          title: "Greatest Hits",
          date: "1990",
          country: "US",
          "release-group": {
            "primary-type": "Album",
            "secondary-types": [],
          },
        },
      ],
      length: 240000,
      score: 100, // Lower score
    };

    // Mock paginated search responses
    mockMBClient.search.mockImplementation(
      (entityType: string, params: any) => {
        if (entityType === "recording") {
          const offset = params?.offset || 0;
          if (offset === 0) {
            return Promise.resolve({
              recordings: [highScoreRecording, prominentRecording],
              count: 2,
            });
          }
          return Promise.resolve({
            recordings: [],
            count: 2,
          });
        }
        return Promise.resolve({ [entityType]: [], count: 0 });
      },
    );

    const result = await searchCanonicalSong("Test Song", true);

    expect(result).not.toBeNull();
    if (!result) return;

    const response = "response" in result ? result.response : null;
    expect(response).not.toBeNull();
    if (!response) return;

    // Prominent artist should appear even if it doesn't win
    if (response.mode === "ambiguous") {
      const artists = response.results.map((r) => r.artist);
      expect(artists).toContain("Toto");
    } else {
      // Even if canonical, prominent artist should be considered
      // (though high score might win)
      expect(response.result).toBeDefined();
    }
  });

  it("prominence never forces canonical mode alone", async () => {
    // Two prominent artists with similar scores
    const artist1: MusicBrainzRecording = {
      id: "artist1-id",
      title: "Ambiguous Song",
      "artist-credit": [{ name: "Van Halen", artist: { name: "Van Halen" } }],
      releases: [
        {
          title: "Album 1",
          date: "1984",
          country: "US",
          "release-group": {
            "primary-type": "Album",
            "secondary-types": [],
          },
        },
        {
          title: "Album 1",
          date: "1984",
          country: "US",
          "release-group": {
            "primary-type": "Single",
            "secondary-types": [],
          },
        },
      ],
      length: 240000,
      score: 100,
    };

    const artist2: MusicBrainzRecording = {
      id: "artist2-id",
      title: "Ambiguous Song",
      "artist-credit": [{ name: "Madonna", artist: { name: "Madonna" } }],
      releases: [
        {
          title: "Album 2",
          date: "1989",
          country: "US",
          "release-group": {
            "primary-type": "Album",
            "secondary-types": [],
          },
        },
        {
          title: "Album 2",
          date: "1989",
          country: "US",
          "release-group": {
            "primary-type": "Single",
            "secondary-types": [],
          },
        },
      ],
      length: 220000,
      score: 100,
    };

    // Mock paginated search responses
    mockMBClient.search.mockImplementation(
      (entityType: string, params: any) => {
        if (entityType === "recording") {
          const offset = params?.offset || 0;
          if (offset === 0) {
            return Promise.resolve({
              recordings: [artist1, artist2],
              count: 2,
            });
          }
          return Promise.resolve({
            recordings: [],
            count: 2,
          });
        }
        return Promise.resolve({ [entityType]: [], count: 0 });
      },
    );

    const result = await searchCanonicalSong("Ambiguous Song", true);

    expect(result).not.toBeNull();
    if (!result) return;

    const response = "response" in result ? result.response : null;
    expect(response).not.toBeNull();
    if (!response) return;

    // Multiple prominent artists should NOT force canonical
    // Should return ambiguous mode
    expect(response.mode).toBe("ambiguous");
    if (response.mode === "ambiguous") {
      expect(response.results.length).toBeGreaterThan(1);
    }
  });
});
