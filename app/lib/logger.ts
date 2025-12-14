// app/lib/logger.ts
//
// Backwards-compatible facade for logging helpers.
// Implementation is split by domain under app/lib/logging/*.

export { logMusicBrainzResponse } from "./logging/musicbrainz";
export { logSearchQuery, logSearchDebugInfo } from "./logging/search";
export { logCreditsResponse } from "./logging/credits";
