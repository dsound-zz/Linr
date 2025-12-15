import OpenAI from "openai";
import { NORMALIZE_RECORDING_TEMPLATE } from "./prompts";
import { formatArtistCredit } from "./musicbrainz";
import { getWikipediaPersonnel } from "./wikipedia";
import { fetchDiscogsCredits } from "./discogs";
import type {
  NormalizedRecording,
  SearchResultItem,
  MusicBrainzRecording,
  MusicBrainzRelease,
  MusicBrainzArtistCreditEntry,
} from "./types";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const client = new OpenAI({ apiKey: OPENAI_API_KEY });

type MutableCredits = NormalizedRecording["credits"];
type MutableLocations = NormalizedRecording["locations"];

interface MusicBrainzRelation {
  type?: string;
  attributes?: string[];
  artist?: { name?: string };
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
  [key: string]: unknown; // For dynamic keys like "*-relation-list"
}

interface MusicBrainzWork {
  relations?: MusicBrainzRelation[];
  [key: string]: unknown; // For dynamic keys like "*-relation-list"
}

function canonicalPersonName(name: string | null | undefined): string {
  const cleaned = (name ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const aliases: Record<string, string> = {
    "dr luke": "lukasz gottwald",
    "dr. luke": "lukasz gottwald",
  };

  return aliases[cleaned] ?? cleaned;
}

function normalizeRole(role: string | null | undefined): string {
  // Normalize roles from MusicBrainz/Wikipedia/Discogs into a comparable form.
  // Discogs commonly uses hyphenated roles like "Written-By".
  return (role ?? "")
    .toLowerCase()
    .trim()
    .replace(/[\[\]\(\)]/g, " ")
    .replace(/[-–—_/\\,;:]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

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
  rel: MusicBrainzRelation,
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

function addArtistCreditPerformers(
  raw: MusicBrainzRecording,
  credits: MutableCredits,
) {
  const ac = raw["artist-credit"] ?? raw.artistCredit ?? [];
  if (!Array.isArray(ac)) return;

  ac.forEach((entry: MusicBrainzArtistCreditEntry | string) => {
    const name =
      typeof entry === "string"
        ? entry
        : (entry?.name ?? entry?.artist?.name ?? "");
    pushPerformer(credits.performers, { name, role: "performer" });
  });
}

function gatherRelationsFromEntity(entity: unknown): MusicBrainzRelation[] {
  const rels: MusicBrainzRelation[] = [];
  if (!entity || typeof entity !== "object") return rels;

  const obj = entity as Record<string, unknown>;

  if (Array.isArray((obj as { relations?: MusicBrainzRelation[] }).relations)) {
    rels.push(...(obj as { relations?: MusicBrainzRelation[] }).relations!);
  }

  Object.keys(obj).forEach((key) => {
    if (key.endsWith("-relation-list") && Array.isArray(obj[key])) {
      rels.push(...(obj[key] as MusicBrainzRelation[]));
    }
  });

  return rels;
}

function gatherAllRelations(
  raw: MusicBrainzRecording,
  release?: MusicBrainzRelease | null,
  releaseGroup?: unknown | null,
): MusicBrainzRelation[] {
  const rels: MusicBrainzRelation[] = [];
  [raw, release, releaseGroup].forEach((entity) => {
    rels.push(...gatherRelationsFromEntity(entity));
  });
  return rels;
}

function collectWorkRelations(
  raw: MusicBrainzRecording,
  release?: MusicBrainzRelease | null,
): MusicBrainzRelation[] {
  const workRels: MusicBrainzRelation[] = [];

  const gatherFrom = (entity: unknown) => {
    gatherRelationsFromEntity(entity).forEach((rel) => {
      const work = rel?.work;
      if (!work) return;
      if (Array.isArray(work.relations)) {
        workRels.push(...work.relations);
      }
      Object.keys(work).forEach((k) => {
        if (k.endsWith("-relation-list") && Array.isArray(work[k])) {
          workRels.push(...(work[k] as MusicBrainzRelation[]));
        }
      });
    });

    if (Array.isArray((entity as { works?: MusicBrainzWork[] })?.works)) {
      (entity as { works?: MusicBrainzWork[] }).works?.forEach((work) => {
        if (Array.isArray(work.relations)) workRels.push(...work.relations);
        Object.keys(work).forEach((k) => {
          if (k.endsWith("-relation-list") && Array.isArray(work[k])) {
            workRels.push(...(work[k] as MusicBrainzRelation[]));
          }
        });
      });
    }
  };

  gatherFrom(raw);
  gatherFrom(release);

  return workRels;
}

export function deriveRecordingFromMB(
  raw: MusicBrainzRecording,
  release?: MusicBrainzRelease | null,
  releaseGroup?: unknown | null,
): NormalizedRecording {
  const primaryRelease =
    release ||
    (Array.isArray(raw?.releases) && raw.releases.length
      ? raw.releases[0]
      : null);

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

  const rels = gatherAllRelations(raw, primaryRelease, releaseGroup);
  rels.forEach((rel) => collectRelationCredits(rel, credits, locations));

  const workRels = collectWorkRelations(raw, primaryRelease);
  workRels.forEach((rel) => collectRelationCredits(rel, credits, locations));

  // Fallback: if no performers were found, treat artist-credit as performers
  if (!credits.performers.length) {
    addArtistCreditPerformers(raw, credits);
  }

  // Fallback: if writers empty, fold composers/lyricists into writers
  if (!credits.writers.length) {
    const merged = new Set<string>(credits.writers);
    [...credits.composers, ...credits.lyricists].forEach((n) => {
      if (n) merged.add(n);
    });
    credits.writers = Array.from(merged);
  }

  const isrc =
    Array.isArray(raw?.isrcs) && raw.isrcs.length ? raw.isrcs[0] : null;

  const releaseId = primaryRelease?.id ?? null;
  const releaseGroupId =
    (primaryRelease?.["release-group"]?.id as string | undefined) ??
    ((releaseGroup as Record<string, unknown> | null)?.id as
      | string
      | undefined) ??
    null;

  const coverArtUrl = releaseId
    ? `https://coverartarchive.org/release/${releaseId}/front-500`
    : releaseGroupId
      ? `https://coverartarchive.org/release-group/${releaseGroupId}/front-500`
      : null;
  const coverArtThumbUrl = releaseId
    ? `https://coverartarchive.org/release/${releaseId}/front-250`
    : releaseGroupId
      ? `https://coverartarchive.org/release-group/${releaseGroupId}/front-250`
      : null;

  return {
    title: raw?.title ?? "",
    artist: formatArtistCredit(raw),
    coverArtUrl,
    coverArtThumbUrl,
    release: {
      title: primaryRelease?.title ?? null,
      date:
        primaryRelease?.date ??
        (typeof (primaryRelease as Record<string, unknown>)?.[
          "first-release-date"
        ] === "string"
          ? ((primaryRelease as Record<string, unknown>)[
              "first-release-date"
            ] as string)
          : null),
      country: primaryRelease?.country ?? null,
    },
    identifiers: {
      mbid: raw?.id ?? raw?.mbid ?? "",
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
    const map = new Map<string, string>();
    const consider = (val?: string) => {
      const clean = (val ?? "").trim();
      if (!clean) return;
      const key = canonicalPersonName(clean);
      const existing = map.get(key);
      if (!existing || clean.length > existing.length) map.set(key, clean);
    };
    a.forEach(consider);
    (b ?? []).forEach(consider);
    return Array.from(map.values());
  };

  const mergePerformers = (
    a: NormalizedRecording["credits"]["performers"],
    b?: NormalizedRecording["credits"]["performers"],
  ) => {
    const out = new Map<string, { name: string; role: string }>();

    const scoreRole = (role: string) => {
      const r = role.toLowerCase();
      if (r === "performer") return 0;
      if (r === "vocals" || r === "vocal") return 1;
      if (r.includes("lead")) return 2;
      return 3;
    };

    const consider = (p?: { name?: string | null; role?: string | null }) => {
      const name = (p?.name ?? "").trim();
      if (!name) return;
      const role = (p?.role ?? "performer").trim();
      const key = canonicalPersonName(name);
      const existing = out.get(key);
      if (!existing) {
        out.set(key, { name, role });
        return;
      }
      const currentScore = scoreRole(existing.role);
      const incomingScore = scoreRole(role);
      if (
        incomingScore > currentScore ||
        (incomingScore === currentScore && name.length > existing.name.length)
      ) {
        out.set(key, { name, role });
      }
    };

    [...a, ...(b ?? [])].forEach(consider);

    return Array.from(out.values());
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
    title: mergeString(base.title, ai.title) || base.title || "",
    artist: mergeString(base.artist, ai.artist) || base.artist || "",
    coverArtUrl: base.coverArtUrl ?? null,
    coverArtThumbUrl: base.coverArtThumbUrl ?? null,
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

function mergeInferred(
  base: NormalizedRecording,
  inferred?: Partial<NormalizedRecording["inferred"]>,
): NormalizedRecording {
  if (!inferred?.credits) return base;

  const mergeStrings = (existing: string[], incoming?: string[]) => {
    const map = new Map<string, string>();
    const consider = (v?: string) => {
      const clean = (v ?? "").trim();
      if (!clean) return;
      const key = canonicalPersonName(clean);
      const prev = map.get(key);
      if (!prev || clean.length > prev.length) map.set(key, clean);
    };
    existing.forEach(consider);
    (incoming ?? []).forEach(consider);
    return Array.from(map.values());
  };

  const mergePerformers = (
    existing: NormalizedRecording["credits"]["performers"],
    incoming?: NormalizedRecording["credits"]["performers"],
  ) => {
    const out = new Map<string, { name: string; role: string }>();
    const scoreRole = (role: string) => {
      const r = role.toLowerCase();
      if (r === "performer") return 0;
      if (r === "vocals" || r === "vocal") return 1;
      if (r.includes("lead")) return 2;
      return 3;
    };

    const consider = (p?: { name?: string | null; role?: string | null }) => {
      const name = (p?.name ?? "").trim();
      if (!name) return;
      const role = (p?.role ?? "performer").trim();
      const key = canonicalPersonName(name);
      const existing = out.get(key);
      if (!existing) {
        out.set(key, { name, role });
        return;
      }
      const currentScore = scoreRole(existing.role);
      const incomingScore = scoreRole(role);
      if (
        incomingScore > currentScore ||
        (incomingScore === currentScore && name.length > existing.name.length)
      ) {
        out.set(key, { name, role });
      }
    };

    [...existing, ...(incoming ?? [])].forEach(consider);
    return Array.from(out.values());
  };

  return {
    ...base,
    credits: {
      ...base.credits,
      writers: mergeStrings(base.credits.writers, inferred.credits.writers),
      producers: mergeStrings(
        base.credits.producers,
        inferred.credits.producers,
      ),
      performers: mergePerformers(
        base.credits.performers,
        inferred.credits.performers,
      ),
    },
    inferred: {
      credits: {
        writers: inferred.credits.writers ?? [],
        producers: inferred.credits.producers ?? [],
        performers: inferred.credits.performers ?? [],
      },
    },
  };
}

async function inferAdditionalCredits(
  title: string,
  artist: string,
): Promise<NormalizedRecording["inferred"]> {
  const prompt = `
Given a well-known song, return any widely-known credits ONLY if you are confident. If unsure, return empty arrays.
Input:
  title: "${title}"
  artist: "${artist}"

Rules:
- Do NOT invent or guess obscure credits.
- Only include names strongly associated with the original studio recording (not live covers).
- Return JSON:
{
  "credits": {
    "writers": string[],
    "producers": string[],
    "performers": [{ "name": string, "role": string }]
  }
}
Use [] when unknown.
`;

  try {
    const response = await client.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [{ role: "user", content: prompt }],
    });

    const json = JSON.parse(response.choices[0].message.content || "{}");
    return json;
  } catch (err) {
    console.error("inferAdditionalCredits failed", err);
    return { credits: {} };
  }
}

function mergeWikipediaPersonnel(
  base: NormalizedRecording,
  personnel: { name: string; role: string }[],
): NormalizedRecording {
  if (!personnel.length) return base;

  const mapRoleToCredits = (entry: { name: string; role: string }) => {
    const role = normalizeRole(entry.role);
    const name = entry.name;
    if (!name) return;

    if (role.includes("producer")) {
      pushUnique(base.credits.producers, name);
      return;
    }

    if (role.includes("engineer") || role.includes("recording")) {
      pushUnique(base.credits.recording_engineers, name);
      return;
    }

    if (role.includes("mix")) {
      pushUnique(base.credits.mixing_engineers, name);
      return;
    }

    if (role.includes("master")) {
      pushUnique(base.credits.mastering_engineers, name);
      return;
    }

    // Writing credits: Discogs uses "written by", "songwriter", etc.
    if (
      role.includes("write") ||
      role.includes("written") ||
      role.includes("songwriter") ||
      role.includes("composition") ||
      role.includes("composer") ||
      role.includes("lyrics") ||
      role.includes("lyric")
    ) {
      // Be conservative: Discogs data can be noisy (e.g. listing band members as
      // "Written-By"). If we already have writers from MusicBrainz/Wikipedia,
      // only accept incoming writing credits that match existing ones.
      const hasExistingWritingCredits =
        base.credits.writers.length > 0 ||
        base.credits.composers.length > 0 ||
        base.credits.lyricists.length > 0;
      if (hasExistingWritingCredits) {
        const existing = new Set(
          [
            ...base.credits.writers,
            ...base.credits.composers,
            ...base.credits.lyricists,
          ].map((n) => canonicalPersonName(n)),
        );
        if (!existing.has(canonicalPersonName(name))) {
          return;
        }
      }

      // Keep Writers section complete; the UI merges writers+composers.
      pushUnique(base.credits.writers, name);
      if (role.includes("composer") || role.includes("composition")) {
        pushUnique(base.credits.composers, name);
      }
      if (role.includes("lyrics") || role.includes("lyric")) {
        pushUnique(base.credits.lyricists, name);
      }
      return;
    }

    pushPerformer(base.credits.performers, {
      name,
      role: entry.role || "performer",
    });
  };

  personnel.forEach(mapRoleToCredits);

  const existingExternal = base.external?.personnel ?? [];
  const dedup = new Map<string, { name: string; role: string }>();
  [...existingExternal, ...personnel].forEach((p) => {
    if (!p?.name) return;
    const key = `${canonicalPersonName(p.name)}::${normalizeRole(p.role)}`;
    if (!dedup.has(key)) {
      dedup.set(key, { name: p.name, role: p.role });
    }
  });

  return {
    ...base,
    external: {
      source: "wikipedia",
      personnel: Array.from(dedup.values()),
    },
  };
}

function mergeExternalPersonnel(
  base: NormalizedRecording,
  personnel: { name: string; role: string }[],
  source: string,
): NormalizedRecording {
  if (!personnel.length) return base;

  const merged = mergeWikipediaPersonnel(base, personnel);
  const existingExternal = merged.external?.personnel ?? [];
  const dedup = new Map<string, { name: string; role: string }>();
  [...existingExternal, ...personnel].forEach((p) => {
    if (!p?.name) return;
    const key = `${canonicalPersonName(p.name)}::${normalizeRole(p.role)}`;
    if (!dedup.has(key)) {
      dedup.set(key, { name: p.name, role: p.role });
    }
  });
  return {
    ...merged,
    external: {
      source,
      personnel: Array.from(dedup.values()),
    },
  };
}

export async function normalizeRecording(
  raw: MusicBrainzRecording,
  opts?: {
    release?: MusicBrainzRelease | null;
    releaseGroup?: unknown | null;
    allowAI?: boolean;
    allowInferred?: boolean;
    allowExternal?: boolean;
  },
): Promise<NormalizedRecording> {
  const derived = deriveRecordingFromMB(raw, opts?.release, opts?.releaseGroup);

  let base = derived;
  let wikiPersonnel: { name: string; role: string }[] = [];

  if (opts?.allowExternal !== false) {
    try {
      wikiPersonnel = await getWikipediaPersonnel(
        derived.title ?? "",
        derived.artist ?? "",
      );
      if (wikiPersonnel.length) {
        base = mergeExternalPersonnel(base, wikiPersonnel, "wikipedia");
      }
    } catch (err) {
      console.error("normalizeRecording wikipedia enrichment failed", err);
    }
  }

  // If external enrichment is enabled and credits are still sparse, try Discogs as a best-effort
  // source for album-level personnel/credits (requires DISCOGS_TOKEN).
  if (opts?.allowExternal !== false) {
    const performerCount = base.credits.performers.length;
    if (performerCount < 3) {
      try {
        const discogsPersonnel = await fetchDiscogsCredits({
          artist: derived.artist ?? "",
          title: derived.title ?? "",
          releaseTitle: opts?.release?.title ?? null,
        });
        if (discogsPersonnel.length) {
          base = mergeExternalPersonnel(base, discogsPersonnel, "discogs");
        }
      } catch (err) {
        console.error("normalizeRecording discogs enrichment failed", err);
      }
    }
  }

  if (opts?.allowAI === false) {
    return base;
  }

  if (!OPENAI_API_KEY) {
    return base;
  }

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
    let merged = mergeNormalized(base, json);

    if (opts?.allowInferred) {
      try {
        const inferred = await inferAdditionalCredits(
          merged.title ?? "",
          merged.artist ?? "",
        );
        merged = mergeInferred(merged, inferred);
      } catch (err) {
        console.error("normalizeRecording inferred credits failed", err);
      }
    }

    if (wikiPersonnel.length && opts?.allowExternal !== false) {
      merged = mergeWikipediaPersonnel(merged, wikiPersonnel);
    }

    return merged;
  } catch (err) {
    console.error(
      "OpenAI normalizeRecording failed, using derived fallback",
      err,
    );
    return base;
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
    source: c.source ?? "musicbrainz",
  }));

  const prompt = `
You are ranking music recordings from MusicBrainz. Given the user's query, return the best-matching recordings first.

User query: "${userQuery}"

Candidates (JSON array):
${JSON.stringify(payload, null, 2)}

Each candidate has a "source" field indicating origin (e.g., "musicbrainz", "wikipedia", or "musicbrainz+wikipedia"). Prefer items that are supported by multiple sources or by Wikipedia when appropriate for mainstream recognition. Do not invent IDs; only return IDs from the provided candidates.

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
