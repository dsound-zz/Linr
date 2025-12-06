import OpenAI from "openai";
import { NORMALIZE_RECORDING_TEMPLATE } from "./prompts";
import type { NormalizedRecording } from "./types";
import type { SearchResultItem } from "./types";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const client = new OpenAI({ apiKey: OPENAI_API_KEY });

export async function normalizeRecording(
  raw: any
): Promise<NormalizedRecording> {
  const prompt = NORMALIZE_RECORDING_TEMPLATE(raw);

  const response = await client.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "user",
        content: prompt,
      },
    ],
  });

  const json = JSON.parse(response.choices[0].message.content || "{}");
  return json;
}

export async function rerankSearchResults(
  candidates: SearchResultItem[],
  userQuery: string
): Promise<SearchResultItem[]> {
  if (!candidates.length) return candidates;

  const payload = candidates.map((c) => ({
    id: c.id,
    title: c.title,
    artist: c.artist,
    releaseTitle: c.releaseTitle,
    year: c.year,
    score: c.score,
  }));

  const prompt = `
You are ranking music recordings from MusicBrainz. Given the user's query, return the best-matching recordings first.

User query: "${userQuery}"

Candidates (JSON array):
${JSON.stringify(payload, null, 2)}

Output the candidate IDs in best-first order as a JSON array of strings. Only include IDs that appear in the candidates. No commentary.
`;

  try {
    const response = await client.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [{ role: "user", content: prompt }],
    });

    const content = response.choices[0].message.content || "{}";
    const parsed = JSON.parse(content);
    const order: string[] = Array.isArray(parsed) ? parsed : parsed.ids || [];

    if (!Array.isArray(order) || order.length === 0) return candidates;

    const map = new Map(candidates.map((c) => [c.id, c]));
    const ordered: SearchResultItem[] = [];
    const seen = new Set<string>();

    order.forEach((id) => {
      if (!id || seen.has(id)) return;
      const item = map.get(id);
      if (item) {
        ordered.push(item);
        seen.add(id);
      }
    });

    candidates.forEach((c) => {
      if (!seen.has(c.id)) ordered.push(c);
    });

    return ordered;
  } catch (err) {
    console.error("OpenAI rerank failed, using original order", err);
    return candidates;
  }
}

export async function inferLikelyArtists(
  title: string,
  limit = 3
): Promise<string[]> {
  const prompt = `
Given a song title, guess up to ${limit} likely mainstream artists who have a well-known song with that exact title. Return as JSON array of strings, most likely first. Title: "${title}"
`;

  try {
    const response = await client.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [{ role: "user", content: prompt }],
    });

    const content = response.choices[0].message.content || "[]";
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed)) {
      return parsed.slice(0, limit).map((s) => String(s));
    }
    if (Array.isArray(parsed.artists)) {
      return parsed.artists.slice(0, limit).map((s: any) => String(s));
    }
    return [];
  } catch (err) {
    console.error("OpenAI inferLikelyArtists failed", err);
    return [];
  }
}
