import OpenAI from 'openai';
import { NORMALIZE_RECORDING_TEMPLATE } from './prompts';
import { formatArtistCredit } from './musicbrainz';
import { normalizeArtistName } from './search/utils/normalizeArtist';
import { getWikipediaPersonnel } from './wikipedia';
import { fetchDiscogsCredits } from './discogs';
import type {
  NormalizedRecording,
  ExternalLinks,
  SearchResultItem,
  MusicBrainzRecording,
  MusicBrainzRelease,
  MusicBrainzArtistCreditEntry,
  MusicBrainzRelation,
} from './types';

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL ?? 'openai/gpt-4o-mini';

const client = new OpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: OPENROUTER_API_KEY,
});

type MutableCredits = NormalizedRecording['credits'];
type MutableLocations = NormalizedRecording['locations'];

// Rest of the original file content remains the same...

// ... continuing the rest of the original file ...
