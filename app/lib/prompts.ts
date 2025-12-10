import type { MusicBrainzRecording } from "./types";

export function NORMALIZE_RECORDING_TEMPLATE(raw: MusicBrainzRecording): string {
  return `
You are a metadata normalizer. Convert this raw MusicBrainz JSON into a clean structure.

RULES:
1. Do NOT hallucinate. Only use info present in input.
2. Missing fields must be null or [].
3. Preserve artist and credit names exactly.
4. Output VALID JSON matching the schema.

SCHEMA:
{
  "title": string,
  "artist": string,
  "release": {
    "title": string | null,
    "date": string | null,
    "country": string | null
  },
  "identifiers": {
    "mbid": string,
    "isrc": string | null
  },
  "credits": {
    "writers": string[],
    "composers": string[],
    "lyricists": string[],
    "producers": string[],
    "recording_engineers": string[],
    "mixing_engineers": string[],
    "mastering_engineers": string[],
    "performers": [{ "role": string, "name": string }]
  }
}

RAW INPUT:
${JSON.stringify(raw)}
  `;
}
