type CreditsVM = {
  title?: string;
  artist?: string;
  release?: { title?: string; date?: string };
  sections: Section[];
};

type Section = {
  id:
    | "performers"
    | "writers"
    | "producers"
    | "engineers"
    | "lyricists"
    | "sources"
    | "mixingEngineers"
    | "masteringEngineers";
  title: string;
  items: Item[];
};

export type Item = {
  primary: string;
  secondary?: string;
};

export default function buildCreditsViewModel(raw: unknown): CreditsVM {
  const sections = [
    buildProducers(raw),
    buildWriters(raw),
    buildLyricists(raw),
    buildPerformers(raw),
    buildEngineers(raw),
    buildMixingEngineers(raw),
    buildMasteringEngineers(raw),
  ]
    .filter((s): s is NonNullable<typeof s> => !!s)
    .filter((s) => s.items.length > 0);

  return { sections };
}

function buildPerformers(raw: unknown): Section | null {
  if (typeof raw !== "object" || raw === null) return null;

  const performers = (raw as { performers?: unknown }).performers;
  if (!Array.isArray(performers)) return null;

  const items = performersToItems(performers);

  return { id: "performers", title: "Performers", items };
}

function buildWriters(raw: unknown): Section | null {
  if (typeof raw !== "object" || raw === null) return null;

  const writers = (raw as { writers?: unknown }).writers;

  const composers = (raw as { composers?: unknown }).composers;

  if (!Array.isArray(writers) || !Array.isArray(composers)) return null;

  const items = stringsToItems([...writers, ...composers]);

  return { id: "writers", title: "Writers", items };
}

function buildLyricists(raw: unknown): Section | null {
  if (typeof raw !== "object" || raw === null) return null;

  const lyricists = (raw as { lyricists?: unknown }).lyricists;

  if (!Array.isArray(lyricists)) return null;

  const items = stringsToItems(lyricists);

  return { id: "lyricists", title: "Lyricists", items };
}

function buildProducers(raw: unknown): Section | null {
  if (typeof raw !== "object" || raw === null) return null;

  const producers = (raw as { producers?: unknown }).producers;
  if (!Array.isArray(producers)) return null;

  const items = stringsToItems(producers);

  return { id: "producers", title: "Producers", items };
}

function buildEngineers(raw: unknown): Section | null {
  if (typeof raw !== "object" || raw === null) return null;

  const engineers = (raw as { recording_engineers?: unknown })
    .recording_engineers;
  if (!Array.isArray(engineers)) return null;

  const items = stringsToItems(engineers);

  return { id: "engineers", title: "Engineers", items };
}

function buildMixingEngineers(raw: unknown): Section | null {
  if (typeof raw !== "object" || raw === null) return null;

  const mixingEngineers = (raw as { mixing_engineers?: unknown })
    .mixing_engineers;
  if (!Array.isArray(mixingEngineers)) return null;

  const items = stringsToItems(mixingEngineers);

  return { id: "mixingEngineers", title: "Mixing Engineers", items };
}

function buildMasteringEngineers(raw: unknown): Section | null {
  if (typeof raw !== "object" || raw === null) return null;

  const masteringEngineers = (raw as { mastering_engineers?: unknown })
    .mastering_engineers;
  if (!Array.isArray(masteringEngineers)) return null;

  const items = stringsToItems(masteringEngineers);

  return { id: "masteringEngineers", title: "Mastering Engineers", items };
}

function stringsToItems(names: string[]): Item[] {
  return names
    .map((name) => name.trim())
    .filter(Boolean)
    .map((name) => ({ primary: name }));
}

function performersToItems(p: { name: string; role: string }[]): Item[] {
  return p.map((x) => {
    // Examples we want to clean:
    // - "background (vocalist)" -> "background"
    // - "instrument (guitar)"   -> "guitar"
    // - "vocal (background vocals)" -> "background"
    const raw = x.role ?? "";
    const parenMatch = raw.match(/^\s*(.*?)\s*\(\s*(.*?)\s*\)\s*$/);
    const outside = parenMatch?.[1] ?? raw;
    const inside = parenMatch?.[2] ?? "";

    // If the outside part is generic, prefer the inside part.
    const outsideIsGeneric = /\b(instrument|vocalist|vocals?|voice)\b/i.test(
      outside,
    );

    const base = (parenMatch ? (outsideIsGeneric ? inside : outside) : raw)
      // Drop generic words wherever they appear.
      .replace(/\b(instrument|vocalist|vocals?|voice)\b/gi, "")
      // Remove leftover punctuation (incl. parentheses if any remain).
      .replace(/[^a-zA-Z0-9\s]/g, "")
      .replace(/\s+/g, " ")
      .trim();

    // Final small cleanup: if we ended up with "background vocals" -> "background"
    const cleanedRole = base.replace(/\bbackground\b\s+\b\b/gi, "background");

    return {
      primary: x.name,
      secondary: cleanedRole.length > 0 ? cleanedRole : undefined,
    };
  });
}
