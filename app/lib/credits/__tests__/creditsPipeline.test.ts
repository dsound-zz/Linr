/**
 * creditsPipeline.test.ts
 *
 * Comprehensive tests for the credits resolution pipeline.
 * Tests cover Toto "Rosanna", deduplication, source mixing, and edge cases.
 * Lyrics are explicitly excluded from all tests.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolveCredits } from "../creditsPipeline";
import { fetchMusicBrainzCredits } from "../musicbrainzCredits";
import type { CreditsEntity } from "../types";

// Mock dependencies
vi.mock("../musicbrainzCredits");
vi.mock("../../musicbrainz", () => ({
  lookupRecording: vi.fn(),
  lookupRelease: vi.fn(),
  getMBClient: vi.fn(),
}));

type WikipediaPersonnelItem = { name: string; role: string };

const { mockGetWikipediaPersonnel, mockSearchWikipediaTrack } = vi.hoisted(
  () => ({
    mockGetWikipediaPersonnel: vi.fn(
      async (
        _title: string,
        _artist: string,
      ): Promise<WikipediaPersonnelItem[]> => [],
    ),
    mockSearchWikipediaTrack: vi.fn(
      async (_query: string): Promise<unknown | null> => null,
    ),
  }),
);

vi.mock("../../wikipedia", () => ({
  getWikipediaPersonnel: mockGetWikipediaPersonnel,
  searchWikipediaTrack: mockSearchWikipediaTrack,
}));

describe("Credits Resolution Pipeline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resolves credits for Toto - Rosanna (MB + Wikipedia mix)", async () => {
    const entity: CreditsEntity = {
      entityType: "recording",
      title: "Rosanna",
      artist: "Toto",
      mbid: "toto-rosanna-mbid",
      year: 1982,
    };

    // Mock MusicBrainz credits (2 credits = sparse, will trigger Wikipedia fetch for all roles)
    (fetchMusicBrainzCredits as ReturnType<typeof vi.fn>).mockResolvedValue({
      credits: [
        {
          role: "producer",
          name: "Toto",
          source: "musicbrainz",
          confidence: 90,
        },
        {
          role: "writer",
          name: "David Paich",
          source: "musicbrainz",
          confidence: 90,
        },
      ],
    });

    // Mock Wikipedia credits (fills missing roles)
    // fetchWikipediaCredits calls getWikipediaPersonnel internally
    // "mixing engineer" should normalize to "mixer"
    // "keyboards" should normalize to "performer" with instrument
    mockGetWikipediaPersonnel.mockResolvedValue([
      { name: "Bruce Swedien", role: "mixing engineer" },
      { name: "David Paich", role: "keyboards" },
    ]);

    const result = await resolveCredits(entity);

    expect(result.title).toBe("Rosanna");
    expect(result.artist).toBe("Toto");
    expect(result.year).toBe(1982);

    // Check that credits are merged and deduplicated
    const producers = result.credits.filter((c) => c.role === "producer");
    expect(producers.length).toBeGreaterThan(0);

    const mixers = result.credits.filter((c) => c.role === "mixer");
    expect(mixers.length).toBeGreaterThan(0);
    expect(mixers[0].name).toBe("Bruce Swedien");
    expect(mixers[0].source).toBe("wikipedia");

    // Check performers are present (from Wikipedia - "keyboards" normalizes to "performer")
    const performers = result.credits.filter((c) => c.role === "performer");
    // Should have at least David Paich from Wikipedia
    expect(performers.length).toBeGreaterThanOrEqual(1);
    const davidPaich = performers.find((p) => p.name === "David Paich");
    expect(davidPaich).toBeDefined();
    expect(davidPaich?.instrument).toBe("keyboard");

    // Verify no lyrics appear
    const lyricists = result.credits.filter((c) => c.role === "lyricist");
    // lyricist role may exist but no lyric content should be present
    expect(lyricists.every((l) => !("lyrics" in l))).toBe(true);
  });

  it("handles album-track-only credits", async () => {
    const entity: CreditsEntity = {
      entityType: "album_track",
      title: "The Dude",
      artist: "Quincy Jones",
      releaseMbid: "release-mbid",
      year: 1981,
    };

    (fetchMusicBrainzCredits as ReturnType<typeof vi.fn>).mockResolvedValue({
      credits: [
        {
          role: "producer",
          name: "Quincy Jones",
          source: "musicbrainz",
          confidence: 75, // Release credits have lower confidence
        },
      ],
    });

    mockGetWikipediaPersonnel.mockResolvedValue([]);

    const result = await resolveCredits(entity);

    expect(result.title).toBe("The Dude");
    expect(result.artist).toBe("Quincy Jones");
    expect(result.credits.length).toBeGreaterThan(0);
    expect(result.credits[0].role).toBe("producer");
  });

  it("falls back to Wikipedia when MB lacks roles", async () => {
    const entity: CreditsEntity = {
      entityType: "recording",
      title: "Test Song",
      artist: "Test Artist",
      mbid: "test-mbid",
    };

    // MB returns minimal credits
    (fetchMusicBrainzCredits as ReturnType<typeof vi.fn>).mockResolvedValue({
      credits: [
        {
          role: "writer",
          name: "Test Writer",
          source: "musicbrainz",
          confidence: 90,
        },
      ],
    });

    // Wikipedia fills missing roles
    mockGetWikipediaPersonnel.mockResolvedValue([
      { name: "Wikipedia Producer", role: "producer" },
      { name: "Wikipedia Mixer", role: "mixing engineer" },
    ]);

    const result = await resolveCredits(entity);

    // Should have both MB and Wikipedia credits
    const writers = result.credits.filter((c) => c.role === "writer");
    expect(writers.length).toBeGreaterThan(0);
    expect(writers[0].source).toBe("musicbrainz");

    const producers = result.credits.filter((c) => c.role === "producer");
    expect(producers.length).toBeGreaterThan(0);
    expect(producers[0].source).toBe("wikipedia");
  });

  it("deduplicates credits across sources", async () => {
    const entity: CreditsEntity = {
      entityType: "recording",
      title: "Test Song",
      artist: "Test Artist",
      mbid: "test-mbid",
    };

    // Same producer in both sources
    (fetchMusicBrainzCredits as ReturnType<typeof vi.fn>).mockResolvedValue({
      credits: [
        {
          role: "producer",
          name: "John Producer",
          source: "musicbrainz",
          confidence: 90,
        },
      ],
    });

    // Same producer in Wikipedia (for deduplication test)
    mockGetWikipediaPersonnel.mockResolvedValue([
      { name: "John Producer", role: "producer" },
    ]);

    const result = await resolveCredits(entity);

    // Should deduplicate - prefer MB (higher confidence)
    const producers = result.credits.filter((c) => c.role === "producer");
    expect(producers.length).toBe(1);
    expect(producers[0].name).toBe("John Producer");
    expect(producers[0].source).toBe("musicbrainz");
    expect(producers[0].confidence).toBe(90);
    // Should note both sources if notes exist
    if (producers[0].notes) {
      expect(producers[0].notes).toContain("musicbrainz");
      expect(producers[0].notes).toContain("wikipedia");
    }
  });

  it("sorts credits by role priority", async () => {
    const entity: CreditsEntity = {
      entityType: "recording",
      title: "Test Song",
      artist: "Test Artist",
      mbid: "test-mbid",
    };

    (fetchMusicBrainzCredits as ReturnType<typeof vi.fn>).mockResolvedValue({
      credits: [
        {
          role: "performer",
          name: "Performer",
          source: "musicbrainz",
          confidence: 90,
        },
        {
          role: "producer",
          name: "Producer",
          source: "musicbrainz",
          confidence: 90,
        },
        {
          role: "writer",
          name: "Writer",
          source: "musicbrainz",
          confidence: 90,
        },
      ],
    });

    mockGetWikipediaPersonnel.mockResolvedValue([]);

    const result = await resolveCredits(entity);

    // Should be sorted: producer, writer, performer
    expect(result.credits[0].role).toBe("producer");
    expect(result.credits[1].role).toBe("writer");
    expect(result.credits[2].role).toBe("performer");
  });

  it("handles missing MBID gracefully", async () => {
    const entity: CreditsEntity = {
      entityType: "recording",
      title: "Test Song",
      artist: "Test Artist",
      // No MBID
    };

    (fetchMusicBrainzCredits as ReturnType<typeof vi.fn>).mockResolvedValue({
      credits: [],
    });

    mockGetWikipediaPersonnel.mockResolvedValue([
      { name: "Wikipedia Producer", role: "producer" },
    ]);

    const result = await resolveCredits(entity);

    expect(result.credits.length).toBeGreaterThan(0);
    expect(result.credits[0].source).toBe("wikipedia");
  });

  it("never includes lyric content", async () => {
    const entity: CreditsEntity = {
      entityType: "recording",
      title: "Test Song",
      artist: "Test Artist",
      mbid: "test-mbid",
    };

    (fetchMusicBrainzCredits as ReturnType<typeof vi.fn>).mockResolvedValue({
      credits: [
        {
          role: "lyricist",
          name: "Test Lyricist",
          source: "musicbrainz",
          confidence: 90,
        },
      ],
    });

    mockGetWikipediaPersonnel.mockResolvedValue([]);

    const result = await resolveCredits(entity);

    // Lyricist role may exist but no lyric content
    const lyricists = result.credits.filter((c) => c.role === "lyricist");
    if (lyricists.length > 0) {
      // Verify no lyric content fields
      expect(lyricists[0]).not.toHaveProperty("lyrics");
      expect(lyricists[0]).not.toHaveProperty("lyric");
      expect(lyricists[0]).not.toHaveProperty("text");
    }
  });
});
