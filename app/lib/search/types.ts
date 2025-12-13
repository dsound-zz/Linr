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
  source?:
    | "release-track"
    | "musicbrainz"
    | "album-title-inferred"
    | "wikipedia-inferred"; // Origin of the recording
}

export interface ReleaseInfo {
  title: string | null;
  year: string | null; // YYYY format
  country: string | null;
  primaryType: string | null; // "Album", "Single", etc.
  secondaryTypes: string[]; // ["Compilation", "Live", etc.]
}

/**
 * Canonical entity types - explicit modeling of what we're returning
 */
export type CanonicalEntityType =
  | "recording" // Clean MusicBrainz recording
  | "album_track" // Track inferred from album context
  | "song_inferred"; // Cultural / Wikipedia-level song

/**
 * Final canonical result returned to the API
 * Unified interface for all entity types
 */
export interface CanonicalResult {
  id: string;
  title: string;
  artist: string;
  year: string | null;
  releaseTitle: string | null;
  entityType: CanonicalEntityType;
  confidenceScore: number;
  source:
    | "musicbrainz"
    | "musicbrainz+wikipedia"
    | "musicbrainz+openai"
    | "wikipedia";
  explanation?: string; // Human-readable reason for entity type
}

/**
 * Search response that can be either canonical (single result) or ambiguous (multiple results)
 */
export type SearchResponse =
  | { mode: "canonical"; result: CanonicalResult }
  | { mode: "ambiguous"; results: CanonicalResult[] };

/**
 * Parsed user query
 */
export interface ParsedQuery {
  title: string;
  artist: string | null;
}

/**
 * Album track candidate - distinct from recordings
 * Represents tracks found via album context (release-track fallback)
 */
export interface AlbumTrackCandidate {
  title: string;
  artist: string;
  year: string | null;
  releaseTitle: string | null;
  releaseId: string;
  confidenceScore?: number; // Optional, lower weight than recordings
  source: "musicbrainz";
}

/**
 * Canonical candidate union type
 * Keeps recordings and album tracks as distinct entity types
 */
export type CanonicalCandidate =
  | {
      entityType: "recording";
      data: NormalizedRecording;
    }
  | {
      entityType: "album_track";
      data: AlbumTrackCandidate;
    };
