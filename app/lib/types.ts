export type ExternalLinks = {
  spotifySearch?: string;
  appleMusicSearch?: string;
  wikipedia?: string;
  discogs?: string;
};

export interface NormalizedRecording {
  title: string;
  artist: string;
  coverArtUrl?: string | null;
  coverArtThumbUrl?: string | null;
  links?: ExternalLinks;
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
  // Store raw MusicBrainz relations to extract artist MBIDs when rendering
  _rawRelations?: MusicBrainzRelation[];
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

export interface ContributorProfile {
  name: string;
  totalContributions: number;
  totalRecordings: number;
  hasMore: boolean;
  roleBreakdown: {
    role: string;
    count: number;
  }[];
  contributions: {
    recordingId: string;
    title: string;
    artist: string;
    releaseDate: string | null;
    roles: string[];
  }[];
}

export interface ContributorKnownFor {
  title: string;
  artist: string;
  recordingMBID?: string;
}

export interface ContributorSearchResult {
  artistMBID: string;
  name: string;
  disambiguation?: string;
  roles: string[];
  knownFor: ContributorKnownFor[];
  area?: string | null;
}

export interface ContributorResult {
  entityType: "contributor";
  artistName: string;
  artistMBID: string;
  primaryRoles?: string[];
  area?: string | null;
}

export interface SongResult {
  entityType: "recording" | "album_track" | "song_inferred";
  title: string;
  artist: string;
  recordingMBID: string;
  year?: number | null;
}

// MusicBrainz API Types
export interface MusicBrainzArtist {
  id?: string;
  name?: string;
  "sort-name"?: string;
  aliases?: Array<{
    name?: string;
    locale?: string;
    primary?: boolean;
    type?: string;
  }>;
  area?: {
    id?: string;
    name?: string;
    "iso-3166-1-codes"?: string[];
  };
  disambiguation?: string;
  score?: number;
  type?: string;
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
  work?: {
    relations?: MusicBrainzRelation[];
    [key: string]: unknown;
  };
  relations?: MusicBrainzRelation[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}
