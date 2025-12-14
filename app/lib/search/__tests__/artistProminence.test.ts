/**
 * Unit tests for artistProminence.ts
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  computeArtistProminence,
  extractArtistMetadata,
  getArtistProminence,
  clearProminenceCache,
} from "../artistProminence";

describe("artistProminence", () => {
  beforeEach(() => {
    clearProminenceCache();
  });

  describe("computeArtistProminence", () => {
    it("scores high for legacy artist (Toto)", () => {
      const meta = {
        artistId: "toto",
        name: "Toto",
        releaseCount: 15,
        albumCount: 8,
        firstReleaseYear: 1978,
        lastReleaseYear: 2020,
        usReleaseCount: 10,
      };

      const prominence = computeArtistProminence(meta);

      expect(prominence.score).toBeGreaterThanOrEqual(30);
      expect(prominence.reasons).toContain("large_discography");
      expect(prominence.reasons).toContain("multiple_studio_albums");
      expect(prominence.reasons).toContain("pre_1990_artist");
      expect(prominence.reasons).toContain("us_market_presence");
    });

    it("scores low for obscure artist", () => {
      const meta = {
        artistId: "obscure-artist",
        name: "Obscure Artist",
        releaseCount: 2,
        albumCount: 1,
        firstReleaseYear: 2020,
        lastReleaseYear: 2021,
        usReleaseCount: 0,
      };

      const prominence = computeArtistProminence(meta);

      expect(prominence.score).toBeLessThan(30);
      expect(prominence.reasons.length).toBe(0);
    });

    it("includes reasons for each scoring factor", () => {
      const meta = {
        artistId: "test-artist",
        name: "Test Artist",
        releaseCount: 12, // >= 10
        albumCount: 6, // >= 5
        firstReleaseYear: 1985, // <= 1990
        lastReleaseYear: 2020,
        usReleaseCount: 3, // >= 1
      };

      const prominence = computeArtistProminence(meta);

      expect(prominence.reasons).toContain("large_discography");
      expect(prominence.reasons).toContain("multiple_studio_albums");
      expect(prominence.reasons).toContain("pre_1990_artist");
      expect(prominence.reasons).toContain("us_market_presence");
      expect(prominence.score).toBe(65); // 20 + 15 + 20 + 10
    });

    it("handles missing optional fields", () => {
      const meta = {
        artistId: "minimal-artist",
        name: "Minimal Artist",
      };

      const prominence = computeArtistProminence(meta);

      expect(prominence.score).toBe(0);
      expect(prominence.reasons.length).toBe(0);
    });
  });

  describe("extractArtistMetadata", () => {
    it("extracts metadata from recording with multiple releases", () => {
      const recording = {
        artist: "Toto",
        releases: [
          {
            year: "1982",
            country: "US",
            primaryType: "Album",
          },
          {
            year: "1983",
            country: "US",
            primaryType: "Single",
          },
          {
            year: "1990",
            country: "GB",
            primaryType: "Album",
          },
        ],
      };

      const meta = extractArtistMetadata(recording);

      expect(meta.name).toBe("Toto");
      expect(meta.releaseCount).toBe(3);
      expect(meta.albumCount).toBe(2);
      expect(meta.firstReleaseYear).toBe(1982);
      expect(meta.lastReleaseYear).toBe(1990);
      expect(meta.usReleaseCount).toBe(2);
    });

    it("handles recordings with no releases", () => {
      const recording = {
        artist: "New Artist",
        releases: [],
      };

      const meta = extractArtistMetadata(recording);

      expect(meta.releaseCount).toBe(0);
      expect(meta.albumCount).toBe(0);
      expect(meta.firstReleaseYear).toBeNull();
      expect(meta.lastReleaseYear).toBeNull();
      expect(meta.usReleaseCount).toBe(0);
    });

    it("handles releases with missing year", () => {
      const recording = {
        artist: "Artist",
        releases: [
          {
            year: null,
            country: "US",
            primaryType: "Album",
          },
          {
            year: "1985",
            country: "US",
            primaryType: "Album",
          },
        ],
      };

      const meta = extractArtistMetadata(recording);

      expect(meta.firstReleaseYear).toBe(1985);
      expect(meta.lastReleaseYear).toBe(1985);
    });
  });

  describe("getArtistProminence", () => {
    it("caches prominence scores", () => {
      const recording = {
        artist: "Toto",
        releases: [
          {
            year: "1982",
            country: "US",
            primaryType: "Album",
          },
          {
            year: "1983",
            country: "US",
            primaryType: "Album",
          },
          {
            year: "1990",
            country: "US",
            primaryType: "Album",
          },
        ],
      };

      const prominence1 = getArtistProminence(recording);
      const prominence2 = getArtistProminence(recording);

      // Should return same object (cached)
      expect(prominence1).toBe(prominence2);
    });

    it("computes prominence for Van Halen-like artist", () => {
      const recording = {
        artist: "Van Halen",
        releases: [
          {
            year: "1984",
            country: "US",
            primaryType: "Album",
          },
          {
            year: "1984",
            country: "US",
            primaryType: "Single",
          },
          {
            year: "1985",
            country: "US",
            primaryType: "Album",
          },
        ],
      };

      const prominence = getArtistProminence(recording);

      // Van Halen should score high (pre-1990, multiple albums, US releases)
      expect(prominence.score).toBeGreaterThanOrEqual(30);
    });

    it("computes prominence for Madonna-like artist", () => {
      const recording = {
        artist: "Madonna",
        releases: [
          {
            year: "1984",
            country: "US",
            primaryType: "Album",
          },
          {
            year: "1984",
            country: "US",
            primaryType: "Single",
          },
        ],
      };

      const prominence = getArtistProminence(recording);

      // Madonna should score high (pre-1990, US releases)
      expect(prominence.score).toBeGreaterThanOrEqual(30);
    });
  });
});
