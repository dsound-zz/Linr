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

export interface SearchResultItem {
  id: string; // recording MBID
  title: string;
  artist: string;
  releaseTitle: string | null;
  year: string | null;
  score: number | null;
}
