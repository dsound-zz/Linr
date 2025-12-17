/**
 * AI-powered contributor verification and enrichment
 *
 * Uses OpenAI to:
 * 1. Verify we have the correct person based on context
 * 2. Filter out obviously incorrect results from MusicBrainz
 * 3. Enrich with well-known credits that might be missing
 */

import OpenAI from 'openai';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const client = OPENAI_API_KEY ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null;

interface ContributorContext {
  name: string;
  mbid: string;
  originatingSong?: {
    title: string;
    artist: string;
    roles: string[]; // e.g., ["producer", "writer"]
  };
}

interface ContributorVerification {
  isCorrectPerson: boolean;
  confidence: number; // 0-1
  biography?: string;
  knownFor?: string[]; // List of well-known works
  birthYear?: number;
  nationality?: string;
}

interface RecordingMatch {
  recording: {
    title: string;
    artist: string;
    date?: string;
  };
  shouldInclude: boolean;
  confidence: number;
  reason?: string;
}

/**
 * Verify if the contributor is the correct person based on context
 */
export async function verifyContributor(
  context: ContributorContext
): Promise<ContributorVerification | null> {
  if (!client) return null;

  const originInfo = context.originatingSong
    ? `They were credited as ${context.originatingSong.roles.join('/')} on "${context.originatingSong.title}" by ${context.originatingSong.artist}.`
    : '';

  const prompt = `You are a music industry expert. Verify the identity of a music contributor.

Contributor: ${context.name}
MusicBrainz ID: ${context.mbid}
${originInfo}

Please provide:
1. Is this likely the correct person we're looking for? (based on the context)
2. A brief biography (1-2 sentences)
3. List 5-10 of their most well-known works
4. Approximate birth year (if known)
5. Nationality (if known)

Return JSON:
{
  "isCorrectPerson": boolean,
  "confidence": number (0-1),
  "biography": string,
  "knownFor": string[] (song titles or "Song - Artist" format),
  "birthYear": number | null,
  "nationality": string | null
}`;

  try {
    const response = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: prompt }],
    });

    const result = JSON.parse(response.choices[0].message.content || '{}');
    return result as ContributorVerification;
  } catch (err) {
    console.error('AI contributor verification failed:', err);
    return null;
  }
}

/**
 * Filter MusicBrainz recordings to only include those relevant to this contributor
 */
export async function filterRecordings(
  contributor: ContributorContext & { verification?: ContributorVerification },
  recordings: Array<{ title: string; artist: string; date?: string }>
): Promise<RecordingMatch[]> {
  if (!client || !contributor.verification) {
    // If no AI available or no verification, include all recordings
    return recordings.map(r => ({
      recording: r,
      shouldInclude: true,
      confidence: 0.5,
    }));
  }

  const { name, verification } = contributor;
  const birthYear = verification.birthYear;
  const knownWorks = verification.knownFor || [];

  // Quick heuristic filtering first (don't waste AI calls on obvious mismatches)
  const filteredRecordings = recordings.filter(r => {
    // If we know birth year, filter out recordings from before they were born
    if (birthYear && r.date) {
      const recordingYear = parseInt(r.date.substring(0, 4));
      if (recordingYear < birthYear - 10) {
        return false; // Recording is from before they could have worked on it
      }
    }
    return true;
  });

  // Batch process recordings with AI (do in chunks of 20)
  const BATCH_SIZE = 20;
  const results: RecordingMatch[] = [];

  for (let i = 0; i < filteredRecordings.length; i += BATCH_SIZE) {
    const batch = filteredRecordings.slice(i, i + BATCH_SIZE);

    const prompt = `You are verifying which recordings belong to music contributor "${name}".

Known information:
- ${verification.biography}
- Known for: ${knownWorks.slice(0, 5).join(', ')}
- Birth year: ${birthYear || 'unknown'}
- Nationality: ${verification.nationality || 'unknown'}

Recordings to verify:
${batch.map((r, idx) => `${idx + 1}. "${r.title}" by ${r.artist} (${r.date || 'unknown date'})`).join('\n')}

For each recording, determine if it's likely by THIS ${name} (not someone else with the same name).
Consider: genre, time period, artist collaborations, and known works.

Return JSON array:
[
  {
    "index": number (1-${batch.length}),
    "shouldInclude": boolean,
    "confidence": number (0-1),
    "reason": string (brief explanation)
  }
]`;

    try {
      const response = await client.chat.completions.create({
        model: 'gpt-4o-mini',
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [{ role: 'user', content: prompt }],
      });

      const content = response.choices[0].message.content || '{}';
      const parsed = JSON.parse(content);
      const batchResults = Array.isArray(parsed) ? parsed : parsed.results || [];

      batch.forEach((recording, idx) => {
        const aiResult = batchResults.find((r: any) => r.index === idx + 1);
        results.push({
          recording,
          shouldInclude: aiResult?.shouldInclude ?? true,
          confidence: aiResult?.confidence ?? 0.5,
          reason: aiResult?.reason,
        });
      });
    } catch (err) {
      console.error('AI recording filtering failed for batch:', err);
      // Include all recordings in this batch if AI fails
      batch.forEach(recording => {
        results.push({
          recording,
          shouldInclude: true,
          confidence: 0.5,
        });
      });
    }
  }

  return results;
}

/**
 * Enrich contributor data with AI-inferred additional works
 */
export async function enrichWithKnownWorks(
  contributor: ContributorContext & { verification?: ContributorVerification }
): Promise<Array<{ title: string; artist: string; confidence: number }>> {
  if (!client || !contributor.verification) return [];

  const { name, verification } = contributor;

  const prompt = `You are providing a list of well-known recordings for music contributor "${name}".

Known information:
- ${verification.biography}
- Known for: ${verification.knownFor?.join(', ')}

Provide 10-15 of their most notable/famous recordings that should definitely appear in their credits.
Focus on hit songs and well-documented collaborations.

Return JSON array:
[
  {
    "title": string (song title),
    "artist": string (primary artist name),
    "confidence": number (0-1, how certain you are this is their work)
  }
]`;

  try {
    const response = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: prompt }],
    });

    const content = response.choices[0].message.content || '{}';
    const parsed = JSON.parse(content);
    const works = Array.isArray(parsed) ? parsed : parsed.recordings || parsed.works || [];

    return works
      .filter((w: any) => w.confidence && w.confidence > 0.7)
      .slice(0, 15);
  } catch (err) {
    console.error('AI enrichment failed:', err);
    return [];
  }
}
