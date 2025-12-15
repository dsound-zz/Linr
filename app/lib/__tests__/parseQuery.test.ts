import { describe, expect, test } from "vitest";

import { parseUserQuery } from "../parseQuery";

describe("parseUserQuery", () => {
  test("respects explicit 'by' separator", () => {
    expect(parseUserQuery("Jump by Van Halen")).toEqual({
      title: "Jump",
      artist: "Van Halen",
    });
  });

  test("does not infer artist from common title tail words", () => {
    expect(parseUserQuery("My Hear Will Go On")).toEqual({
      title: "My Hear Will Go On",
      artist: null,
    });
  });

  test("still infers artist for proper names at end", () => {
    expect(parseUserQuery("Perfect Ed Sheeran")).toEqual({
      title: "Perfect",
      artist: "Ed Sheeran",
    });
  });
});
