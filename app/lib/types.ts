export interface NormalizedRecording {
  title: string;
  artist: string;
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
}
