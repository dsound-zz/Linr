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

  // Combine writers and composers into a Set<string> to ensure uniqueness
  const writersSet = new Set<string>();
  for (const writer of [...writers, ...composers]) {
    if (typeof writer === "string") {
      writersSet.add(writer);
    }
  }
  const items = stringsToItems(Array.from(writersSet));

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
    // Rules:
    // - If the role looks like "instrument (trumpet)" or "vocalist (vocals)", use ONLY the parenthetical part.
    // - If there is NO parenthetical part (e.g. "vocals"), leave it unchanged.
    // - If the role is "background (vocalist)", keep "background" (outer is non-generic).
    const raw = (x.role ?? "").trim();
    if (!raw) {
      return { primary: x.name };
    }

    const parenMatch = raw.match(/^\s*(.*?)\s*\(\s*(.*?)\s*\)\s*$/);
    const outside = (parenMatch?.[1] ?? raw).trim();
    const inside = (parenMatch?.[2] ?? "").trim();

    // Only treat the outer label as "generic" when it is a container word.
    // In those cases, prefer the parenthetical detail (instrument, vocals, etc).
    const outsideIsGeneric =
      /\b(instrument|instruments|vocal|vocals|vocalist|voice|performer)\b/i.test(
        outside,
      );

    const cleanedRole = parenMatch
      ? outsideIsGeneric
        ? inside || outside
        : outside
      : raw;

    return {
      primary: x.name,
      secondary: cleanedRole.length > 0 ? cleanedRole : undefined,
    };
  });
}
