/**
 * types.ts
 *
 * Type definitions for the credits resolution pipeline.
 * Lyrics are explicitly excluded from all types.
 */

/**
 * Credit roles supported by the pipeline
 * Note: lyricist is included for completeness but lyrics content is never fetched
 */
export type CreditRole =
  | "producer"
  | "co_producer"
  | "writer"
  | "composer"
  | "lyricist" // Role name only - no lyric content
  | "mixer"
  | "recording_engineer"
  | "mastering_engineer"
  | "performer"
  | "featured_artist"
  | "arranger"
  | "conductor"
  | "art_direction"
  | "cover_art"
  | "photography";

/**
 * Source of credit information
 */
export type CreditSource = "musicbrainz" | "wikipedia";

/**
 * A single credit entry
 */
export interface Credit {
  role: CreditRole;
  name: string;
  instrument?: string; // For performers
  source: CreditSource;
  confidence: number; // 0-100, higher = more reliable
  notes?: string; // Optional context
}

/**
 * Recording location information
 */
export interface RecordingLocation {
  studio?: string;
  city?: string;
  country?: string;
}

/**
 * Cover art information
 */
export interface CoverArt {
  imageUrl: string;
  source: CreditSource;
}

/**
 * Complete credits for a recording
 */
export interface RecordingCredits {
  title: string;
  artist: string;
  year: number | null;
  credits: Credit[];
  recordingLocation?: RecordingLocation;
  coverArt?: CoverArt;
}

/**
 * Input entity for credits resolution
 */
export interface CreditsEntity {
  entityType: "recording" | "album_track";
  title: string;
  artist: string;
  mbid?: string; // MusicBrainz ID for recording
  releaseMbid?: string; // MusicBrainz ID for release (for album tracks)
  year?: number | null;
}

/**
 * Confidence levels for credits
 */
export const CONFIDENCE = {
  MUSICBRAINZ_HIGH: 90,
  MUSICBRAINZ_MEDIUM: 75,
  MUSICBRAINZ_LOW: 60,
  WIKIPEDIA_HIGH: 70,
  WIKIPEDIA_MEDIUM: 55,
  WIKIPEDIA_LOW: 40,
} as const;
