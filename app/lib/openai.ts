import OpenAI from "openai";
import { NORMALIZE_RECORDING_TEMPLATE } from "./prompts";
import { formatArtistCredit } from "./musicbrainz";
import type {
  NormalizedRecording,
  SearchResultItem,
  MusicBrainzRecording,
} from "./types";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const client = new OpenAI({ apiKey: OPENAI_API_KEY });

type MutableCredits = NormalizedRecording["credits"];
type MutableLocations = NormalizedRecording["locations"];

function pushUnique(list: string[], name?: string | null) {
  const clean = (name ?? "").trim();
  if (!clean) return;
  if (!list.includes(clean)) list.push(clean);
}

function pushPerformer(
  list: NormalizedRecording["credits"]["performers"],
  entry: { role?: string | null; name?: string | null },
) {
  const name = (entry.name ?? "").trim();
  if (!name) return;
  const role = (entry.role ?? "performer").trim();
  const key = `${name}::${role}`;
  if (list.some((p) => `${p.name}::${p.role}` === key)) return;
  list.push({ name, role });
}

function pushLocation(list: MutableLocations, entry: MutableLocations[number]) {
  const name = (entry.name ?? "").trim();
  if (!name) return;
  const role = (entry.role ?? "location").trim();
  const key = `${name}::${role}`;
  if (list.some((loc) => `${loc.name}::${loc.role}` === key)) return;
  list.push({
    role,
    name,
    area: entry.area ?? null,
    country: entry.country ?? null,
  });
}

function collectRelationCredits(
  rel: any,
  credits: MutableCredits,
  locations: MutableLocations,
) {
  const type = (rel?.type ?? "").toLowerCase();
  const attrs: string[] = Array.isArray(rel?.attributes)
    ? rel.attributes.filter(Boolean)
    : [];
  const name =
    rel?.artist?.name ??
    rel?.name ??
    rel?.target?.name ??
    rel?.["target-credit"] ??
    null;
  const role =
    (rel?.type ?? "").trim() + (attrs.length ? ` (${attrs.join(", ")})` : "");

  // Locations (place relations)
  if (rel?.place) {
    const area = rel.place.area?.name ?? null;
    const iso =
      rel.place.area?.["iso-3166-1-codes"] ??
      rel.place.area?.iso_3166_1_codes ??
      rel.place.area?.iso_3166_1_codes;
    const country = Array.isArray(iso) && iso.length ? iso[0] : null;
    pushLocation(locations, {
      role: rel.type ?? "location",
      name: rel.place.name ?? "",
      area,
      country,
    });
  }

  if (!type) return;

  if (type.includes("composer")) {
    pushUnique(credits.composers, name);
    return;
  }

  if (type.includes("lyric")) {
    pushUnique(credits.lyricists, name);
    return;
  }

  if (type.includes("writer") || type === "author") {
    pushUnique(credits.writers, name);
    return;
  }

  if (type.includes("producer")) {
    pushUnique(credits.producers, name);
    return;
  }

  if (type.includes("mix")) {
    pushUnique(credits.mixing_engineers, name);
    return;
  }

  if (type.includes("master")) {
    pushUnique(credits.mastering_engineers, name);
    return;
  }

  if (type.includes("engineer")) {
    pushUnique(credits.recording_engineers, name);
    return;
  }

  const performerBase = [
    "performer",
    "vocal",
    "voice",
    "background",
    "singer",
    "instrument",
    "guitar",
    "bass",
    "drum",
    "piano",
    "keyboard",
    "horn",
    "sax",
    "trumpet",
    "synthesizer",
    "programming",
    "violin",
    "cello",
    "strings",
    "orchestra",
    "choir",
  ];

  const performerTriggers = Array.from(
    new Set(
      performerBase.flatMap((w) => {
        const forms = [w];
        if (!w.endsWith("s")) forms.push(`${w}s`);
        if (!w.endsWith("ist")) forms.push(`${w}ist`, `${w}ists`);
        return forms;
      }),
    ),
  );

  if (performerTriggers.some((kw) => type.includes(kw))) {
    pushPerformer(credits.performers, { name, role: role || type });
  }
}

function gatherAllRelations(raw: any): any[] {
  const rels: any[] = [];

  if (Array.isArray(raw?.relations)) rels.push(...raw.relations);

  Object.keys(raw ?? {}).forEach((key) => {
    if (key.endsWith("-relation-list") && Array.isArray(raw[key])) {
      rels.push(...raw[key]);
    }
  });

  return rels;
}

function collectWorkRelations(raw: any): any[] {
  const workRels: any[] = [];

  const rels = gatherAllRelations(raw);
  rels.forEach((rel) => {
    const work = rel?.work;
    if (!work) return;
    if (Array.isArray(work.relations)) {
      workRels.push(...work.relations);
    }
    Object.keys(work).forEach((k) => {
      if (k.endsWith("-relation-list") && Array.isArray(work[k])) {
        workRels.push(...work[k]);
      }
    });
  });

  if (Array.isArray(raw?.works)) {
    raw.works.forEach((work: any) => {
      if (Array.isArray(work.relations)) workRels.push(...work.relations);
      Object.keys(work).forEach((k) => {
        if (k.endsWith("-relation-list") && Array.isArray(work[k])) {
          workRels.push(...work[k]);
        }
      });
    });
  }

  return workRels;
}

function deriveRecordingFromMB(raw: MusicBrainzRecording): NormalizedRecording {
  const release =
    Array.isArray(raw?.releases) && raw.releases.length
      ? raw.releases[0]
      : null;

  const credits: MutableCredits = {
    writers: [],
    composers: [],
    lyricists: [],
    producers: [],
    recording_engineers: [],
    mixing_engineers: [],
    mastering_engineers: [],
    performers: [],
  };

  const locations: MutableLocations = [];

  const rels = gatherAllRelations(raw);
  rels.forEach((rel) => collectRelationCredits(rel, credits, locations));

  const workRels = collectWorkRelations(raw);
  workRels.forEach((rel) => collectRelationCredits(rel, credits, locations));

  const isrc =
    Array.isArray(raw?.isrcs) && raw.isrcs.length ? raw.isrcs[0] : null;

  return {
    title: raw?.title ?? "",
    artist: formatArtistCredit(raw),
    release: {
      title: release?.title ?? null,
      date: release?.date ?? null,
      country: release?.country ?? null,
    },
    identifiers: {
      mbid: (raw as any)?.id ?? "",
      isrc,
    },
    locations,
    credits,
  };
}

function mergeNormalized(
  base: NormalizedRecording,
  ai: Partial<NormalizedRecording> | null | undefined,
): NormalizedRecording {
  const mergeString = (a: string | null, b?: string | null) =>
    (b ?? "").trim() || a;

  const mergeArray = (a: string[], b?: string[]) => {
    const set = new Set<string>(a);
    (b ?? []).forEach((item) => {
      const clean = (item ?? "").trim();
      if (clean) set.add(clean);
    });
    return Array.from(set);
  };

  const mergePerformers = (
    a: NormalizedRecording["credits"]["performers"],
    b?: NormalizedRecording["credits"]["performers"],
  ) => {
    const seen = new Set<string>();
    const out: NormalizedRecording["credits"]["performers"] = [];
    [...a, ...(b ?? [])].forEach((p) => {
      const name = (p?.name ?? "").trim();
      if (!name) return;
      const role = (p?.role ?? "performer").trim();
      const key = `${name}::${role}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ name, role });
    });
    return out;
  };

  const mergeLocations = (
    a: NormalizedRecording["locations"],
    b?: NormalizedRecording["locations"],
  ) => {
    const seen = new Set<string>();
    const out: NormalizedRecording["locations"] = [];
    [...a, ...(b ?? [])].forEach((loc) => {
      const name = (loc?.name ?? "").trim();
      if (!name) return;
      const role = (loc?.role ?? "location").trim();
      const key = `${name}::${role}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push({
        name,
        role,
        area: loc?.area ?? null,
        country: loc?.country ?? null,
      });
    });
    return out;
  };

  if (!ai) return base;

  return {
    title: mergeString(base.title, ai.title),
    artist: mergeString(base.artist, ai.artist),
    release: {
      title: mergeString(base.release.title, ai.release?.title) || null,
      date: mergeString(base.release.date, ai.release?.date) || null,
      country: mergeString(base.release.country, ai.release?.country) || null,
    },
    identifiers: {
      mbid: mergeString(base.identifiers.mbid, ai.identifiers?.mbid) || "",
      isrc: mergeString(base.identifiers.isrc, ai.identifiers?.isrc) || null,
    },
    locations: mergeLocations(base.locations, ai.locations),
    credits: {
      writers: mergeArray(base.credits.writers, ai.credits?.writers),
      composers: mergeArray(base.credits.composers, ai.credits?.composers),
      lyricists: mergeArray(base.credits.lyricists, ai.credits?.lyricists),
      producers: mergeArray(base.credits.producers, ai.credits?.producers),
      recording_engineers: mergeArray(
        base.credits.recording_engineers,
        ai.credits?.recording_engineers,
      ),
      mixing_engineers: mergeArray(
        base.credits.mixing_engineers,
        ai.credits?.mixing_engineers,
      ),
      mastering_engineers: mergeArray(
        base.credits.mastering_engineers,
        ai.credits?.mastering_engineers,
      ),
      performers: mergePerformers(
        base.credits.performers,
        ai.credits?.performers,
      ),
    },
  };
}

export async function normalizeRecording(
  raw: MusicBrainzRecording,
): Promise<NormalizedRecording> {
  const derived = deriveRecordingFromMB(raw);

  if (!OPENAI_API_KEY) return derived;

  try {
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
    return mergeNormalized(derived, json);
  } catch (err) {
    console.error(
      "OpenAI normalizeRecording failed, using derived fallback",
      err,
    );
    return derived;
  }
}

export async function rerankSearchResults(
  candidates: SearchResultItem[],
  userQuery: string,
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
  limit = 3,
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
      return parsed.artists.slice(0, limit).map((s: unknown) => String(s));
    }
    return [];
  } catch (err) {
    console.error("OpenAI inferLikelyArtists failed", err);
    return [];
  }
}
