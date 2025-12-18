/**
 * openai.ts (OPTIONAL, FINAL stage)
 *
 * Used ONLY if:
 * - multiple candidates remain close in score
 *
 * Task: choose most culturally recognized studio recording
 * Input should be CLEAN (max 5 candidates)
 */

import OpenAI from "openai";
import type { CanonicalResult } from "./types";
import { OPENAI_MODEL } from "../config";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * Rerank candidates using OpenAI to pick the most culturally recognized version
 *
 * Input: max 5 candidates (should be pre-filtered and scored)
 * Returns: reranked list with updated source tag
 */
export async function rerankCandidates(
  candidates: CanonicalResult[],
  query: string,
): Promise<CanonicalResult[]> {
  if (candidates.length === 0 || candidates.length > 5) {
    return candidates; // Don't rerank if empty or too many
  }

  if (candidates.length === 1) {
    return candidates; // No need to rerank single candidate
  }

  try {
    const prompt = `You are ranking music recordings to identify the most culturally significant and widely recognized version of a song.

Query: "${query}"

Candidates:
${candidates
  .map(
    (c, i) =>
      `${i + 1}. ID: ${c.id}, Title: "${c.title}", Artist: "${c.artist}", Year: ${c.year ?? "unknown"}`,
  )
  .join("\n")}

RANKING CRITERIA (in order of importance):
1. **Mainstream recognition**: Prefer the version that charted, became a hit, or is most widely known
2. **Original studio recording**: Prefer original artists over covers, tributes, or compilations
3. **Commercial success**: Prefer versions that had radio play, album sales, or streaming popularity
4. **Cultural impact**: Prefer versions that defined the song or became iconic
5. **Recency as tiebreaker**: For truly equal versions, slightly prefer the earlier release

EXAMPLES:
- "Reminiscing" → Little River Band (1978) is the famous hit, not Russell Garcia or Buddy Holly versions
- "Jump" → Van Halen (1983) is the massive hit, not Pointer Sisters or other covers
- "Africa" → Toto (1982) is the iconic version, not tribute bands

Return a JSON object with an "ids" array containing ALL candidate IDs ranked from most to least recognized:
{ "ids": ["id1", "id2", "id3", ...] }`;

    const response = await client.chat.completions.create({
      model: OPENAI_MODEL,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [{ role: "user", content: prompt }],
    });

    const content = response.choices[0].message.content || "{}";
    const parsed = JSON.parse(content);

    // Extract ordered IDs
    const orderedIds: string[] = Array.isArray(parsed.ids) ? parsed.ids : [];

    if (orderedIds.length === 0) {
      return candidates; // Fallback to original order
    }

    // Create map for quick lookup
    const map = new Map(candidates.map((c) => [c.id, c]));
    const seen = new Set<string>();

    // Build reranked list
    const reranked: CanonicalResult[] = [];

    // Add in OpenAI order
    for (const id of orderedIds) {
      const candidate = map.get(id);
      if (candidate && !seen.has(id)) {
        reranked.push({ ...candidate, source: "musicbrainz+openai" });
        seen.add(id);
      }
    }

    // Add any remaining candidates
    for (const candidate of candidates) {
      if (!seen.has(candidate.id)) {
        reranked.push(candidate);
      }
    }

    return reranked;
  } catch (err) {
    console.error("OpenAI rerank failed, using original order", err);
    return candidates;
  }
}
