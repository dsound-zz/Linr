import { describe, it, expect, beforeEach, vi } from "vitest";

import { inferSearchIntent } from "../inferIntent";
import type { ContributorSearchResult } from "@/lib/types";

const mockSearchContributorsByName = vi.hoisted(() =>
  vi.fn<() => Promise<ContributorSearchResult[]>>(),
);
const mockMBClient = vi.hoisted(() => ({
  search: vi.fn(),
}));

vi.mock("../searchContributors", () => ({
  searchContributorsByName: mockSearchContributorsByName,
}));

vi.mock("@/lib/musicbrainz", () => ({
  getMBClient: () => mockMBClient,
}));

describe("inferSearchIntent", () => {
  beforeEach(() => {
    mockSearchContributorsByName.mockReset();
    mockMBClient.search.mockReset();
  });

  function mockSearchCounts(recordings: number, artists: number) {
    mockMBClient.search.mockImplementation(async (entity: string) => {
      if (entity === "recording") {
        return {
          recordings: Array.from({ length: recordings }, (_, i) => ({
            id: `rec-${i}`,
            title: `Recording ${i}`,
          })),
        };
      }
      if (entity === "artist") {
        return {
          artists: Array.from({ length: artists }, (_, i) => ({
            id: `artist-${i}`,
            name: `Artist ${i}`,
          })),
        };
      }
      return {};
    });
  }

  it("keeps contributor intent when artist results dominate", async () => {
    mockSearchContributorsByName.mockResolvedValue([
      {
        artistMBID: "max-martin",
        name: "Max Martin",
        roles: [],
        knownFor: [],
      },
    ]);
    mockSearchCounts(1, 4);

    const result = await inferSearchIntent("Max Martin");
    expect(result.intent.type).toBe("contributor");
  });

  it("forces song intent when recordings dominate", async () => {
    mockSearchContributorsByName.mockResolvedValue([
      {
        artistMBID: "artist-1",
        name: "Chic",
        roles: [],
        knownFor: [],
      },
    ]);
    mockSearchCounts(4, 1);

    const result = await inferSearchIntent("Le Freak");
    expect(result.intent.type).toBe("song");
    expect(result.contributorMatches).toHaveLength(1);
  });

  it("biases toward song when both recording and artist counts are zero", async () => {
    mockSearchContributorsByName.mockResolvedValue([
      {
        artistMBID: "artist-2",
        name: "Imagine Artist",
        roles: [],
        knownFor: [],
      },
    ]);
    mockSearchCounts(0, 0);

    const result = await inferSearchIntent("Imagine");
    expect(result.intent.type).toBe("song");
  });
});
