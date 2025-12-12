/**
 * Core data types for the Canonical Song Search pipeline
 */

/**
 * Normalized internal representation of a recording
 * This is the shape used throughout the pipeline after normalization
 */
export interface NormalizedRecording {
  id: string;
  title: string;
  artist: string;
  releases: ReleaseInfo[];
  lengthMs: number | null;
  score: number | null; // MusicBrainz search score
}

export interface ReleaseInfo {
  title: string | null;
  year: string | null; // YYYY format
  country: string | null;
  primaryType: string | null; // "Album", "Single", etc.
  secondaryTypes: string[]; // ["Compilation", "Live", etc.]
}

/**
 * Final canonical result returned to the API
 */
export interface CanonicalResult {
  id: string;
  title: string;
  artist: string;
  year: string | null;
  releaseTitle: string | null;
  confidenceScore: number;
  source:
    | "musicbrainz"
    | "musicbrainz+wikipedia"
    | "musicbrainz+openai"
    | "wikipedia";
}

/**
 * Parsed user query
 */
export interface ParsedQuery {
  title: string;
  artist: string | null;
}
