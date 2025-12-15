import { describe, expect, test } from "vitest";

import { getObviousSongForTitle } from "../obviousSongs";

describe("getObviousSongForTitle", () => {
  test("matches canonical obvious songs", () => {
    expect(getObviousSongForTitle("I will always love you")).toEqual({
      artist: "Whitney Houston",
      canonicalTitle: "I Will Always Love You",
    });
    expect(getObviousSongForTitle("I Wish")).toEqual({
      artist: "Stevie Wonder",
      canonicalTitle: "I Wish",
    });
  });

  test("handles common typos (hear -> heart)", () => {
    expect(getObviousSongForTitle("My Hear Will Go On")).toEqual({
      artist: "Celine Dion",
      canonicalTitle: "My Heart Will Go On",
    });
    expect(getObviousSongForTitle("My Heart Will Go On")).toEqual({
      artist: "Celine Dion",
      canonicalTitle: "My Heart Will Go On",
    });
  });
});
