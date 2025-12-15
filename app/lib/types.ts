export interface NormalizedRecording {
  title: string;
  artist: string;
  coverArtUrl?: string | null;
  coverArtThumbUrl?: string | null;
  release: {
    title: string | null;
    date: string | null;
    country: string | null;
  };
  identifiers: {
    mbid: string;
    isrc: string | null;
  };
  locations: {
    role: string;
    name: string;
    area: string | null;
    country: string | null;
  }[];
  credits: {
    writers: string[];
    composers: string[];
    lyricists: string[];
    producers: string[];
    recording_engineers: string[];
    mixing_engineers: string[];
    mastering_engineers: string[];
    performers: { role: string; name: string }[];
  };
  external?: {
    source?: string;
    personnel?: { role: string; name: string }[];
  };
  inferred?: {
    credits: {
      writers?: string[];
      producers?: string[];
      performers?: { role: string; name: string }[];
    };
  };
}

// MusicBrainz API Types
export interface MusicBrainzArtist {
  id?: string;
  name?: string;
  "sort-name"?: string;
}

export interface MusicBrainzArtistCreditEntry {
  name?: string;
  artist?: MusicBrainzArtist;
  joinphrase?: string;
}

export type MusicBrainzArtistCredit = (MusicBrainzArtistCreditEntry | string)[];

export interface MusicBrainzReleaseGroup {
  id?: string;
  title?: string;
  "primary-type"?: string;
  "secondary-types"?: string[];
  disambiguation?: string;
}

export interface MusicBrainzRelease {
  id?: string;
  title?: string;
  date?: string;
  country?: string;
  disambiguation?: string;
  "release-group"?: MusicBrainzReleaseGroup;
  relations?: MusicBrainzRelation[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

export interface MusicBrainzRecording {
  id?: string;
  mbid?: string;
  title?: string;
  disambiguation?: string;
  length?: number | null;
  score?: number;
  "ext:score"?: string | number;
  "first-release-date"?: string;
  "artist-credit"?: MusicBrainzArtistCredit;
  artistCredit?: MusicBrainzArtistCredit;
  releases?: MusicBrainzRelease[];
  artist?: string; // Sometimes added by our code
  relations?: MusicBrainzRelation[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

export interface MusicBrainzSearchResponse {
  recordings?: MusicBrainzRecording[];
  artists?: MusicBrainzArtist[];
  count?: number;
  offset?: number;
}

export interface SearchResultItem {
  id: string; // recording MBID
  title: string;
  artist: string;
  year: string | null;
  score: number | null;
  durationMs?: number | null;
  releases?: MusicBrainzRelease[]; // optional raw releases array from MusicBrainz
  releaseTitle?: string | null;
  source?: string; // e.g., musicbrainz (default) or wikipedia
}

export interface MusicBrainzRelation {
  type?: string;
  attributes?: string[];
  artist?: MusicBrainzArtist;
  name?: string;
  target?: { name?: string };
  "target-credit"?: string;
  place?: {
    name?: string;
    area?: {
      name?: string;
      "iso-3166-1-codes"?: string[];
      iso_3166_1_codes?: string[];
    };
  };
  work?: unknown;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}
