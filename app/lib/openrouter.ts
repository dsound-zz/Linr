import OpenAI from 'openai';

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

const client = new OpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: OPENROUTER_API_KEY,
});

export interface ProcessedRecording {
  title: string;
  artists: string[];
  duration: number;
  isrc?: string;
  credits?: {
    performers: Array<{name: string, role: string}>;
  };
  recordings: Array<{
    title: string;
    artist: string;
    duration: number;
  }>;
}

export const processRecordingWithAI = async (mbData: any): Promise<ProcessedRecording> => {
  const client = new OpenAI({
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey: process.env.OPENROUTER_API_KEY!,
    defaultHeaders: {
      'HTTP-Referer': 'https://linr.app',
      'X-Title': 'Linr Music Discovery'
    },
  });

  // Existing MusicBrainz processing logic
  const derived = {
    title: mbData.title,
    artists: mbData.artists,
    duration: mbData.length,
    isrc: mbData.isrcs?.[0],
  };

  // Normalize structure for DB consistency
  return {
    ...derived,
    recordings: mbData.recordings.map((r: any) => ({
      title: r.title,
      artist: r.artist,
      duration: r.length
    }))
  };
};
