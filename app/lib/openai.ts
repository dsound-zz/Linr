import OpenAI from "openai";
import { NORMALIZE_RECORDING_TEMPLATE } from "./prompts";
import type { NormalizedRecording } from "./types";

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
