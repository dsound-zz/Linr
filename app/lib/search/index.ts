/**
 * Canonical Song Search Module
 *
 * Main entry point for the search pipeline
 */

export { searchCanonicalSong } from "./pipeline";
export type {
  CanonicalResult,
  NormalizedRecording,
  ParsedQuery,
} from "./types";

// Export individual modules for testing/debugging
export * from "./search";
export * from "./normalize";
export * from "./filters";
export * from "./rank";
export * from "./canonical";
export * from "./wikipedia";
export * from "./openai";
