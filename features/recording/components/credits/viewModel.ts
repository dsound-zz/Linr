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
  mbid?: string; // MusicBrainz artist ID for linking to contributor page
};

// Helper to extract MBID from raw relations by matching artist name
function findArtistMbid(name: string, rawRelations?: unknown[]): string | undefined {
  if (!Array.isArray(rawRelations)) return undefined;

  for (const rel of rawRelations) {
    if (typeof rel !== 'object' || !rel) continue;
    const relation = rel as Record<string, any>;

    const artistName = relation.artist?.name;
    const artistId = relation.artist?.id;

    if (artistName === name && artistId) {
      return artistId;
    }
  }

  return undefined;
}

export default function buildCreditsViewModel(recording: unknown): CreditsVM {
  // Extract credits from the recording data
  const raw = typeof recording === 'object' && recording !== null
    ? (recording as { credits?: unknown }).credits
    : null;

  const sections = [
    buildProducers(recording),
    buildWriters(recording),
    buildLyricists(recording),
    buildPerformers(recording),
    buildEngineers(recording),
    buildMixingEngineers(recording),
    buildMasteringEngineers(recording),
  ]
    .filter((s): s is NonNullable<typeof s> => !!s)
    .filter((s) => s.items.length > 0);

  return { sections };
}

function buildPerformers(recording: unknown): Section | null {
  if (typeof recording !== "object" || recording === null) return null;

  const credits = (recording as { credits?: unknown }).credits;
  if (typeof credits !== "object" || credits === null) return null;

  const performers = (credits as { performers?: unknown }).performers;
  const external = (recording as { external?: { personnel?: unknown } }).external;
  const externalPersonnel = external?.personnel;
  const rawRelations = (recording as { _rawRelations?: unknown })._rawRelations;

  const allPerformers: { name: string; role: string }[] = [];

  // Add regular performers
  if (Array.isArray(performers)) {
    allPerformers.push(...performers);
  }

  // Add external personnel
  if (Array.isArray(externalPersonnel)) {
    allPerformers.push(...externalPersonnel);
  }

  if (allPerformers.length === 0) return null;

  const items = performersToItems(allPerformers, rawRelations as unknown[] | undefined);

  return { id: "performers", title: "Performers", items };
}

function buildWriters(recording: unknown): Section | null {
  if (typeof recording !== "object" || recording === null) return null;

  const credits = (recording as { credits?: unknown }).credits;
  if (typeof credits !== "object" || credits === null) return null;

  const writers = (credits as { writers?: unknown }).writers;
  const composers = (credits as { composers?: unknown }).composers;
  const rawRelations = (recording as { _rawRelations?: unknown })._rawRelations;

  if (!Array.isArray(writers) || !Array.isArray(composers)) return null;

  // Combine writers and composers into a Set<string> to ensure uniqueness
  const writersSet = new Set<string>();
  for (const writer of [...writers, ...composers]) {
    if (typeof writer === "string") {
      writersSet.add(writer);
    }
  }
  const items = stringsToItems(Array.from(writersSet), rawRelations as unknown[] | undefined);

  return { id: "writers", title: "Writers", items };
}

function buildLyricists(recording: unknown): Section | null {
  if (typeof recording !== "object" || recording === null) return null;

  const credits = (recording as { credits?: unknown }).credits;
  if (typeof credits !== "object" || credits === null) return null;

  const lyricists = (credits as { lyricists?: unknown }).lyricists;
  const rawRelations = (recording as { _rawRelations?: unknown })._rawRelations;

  if (!Array.isArray(lyricists)) return null;

  const items = stringsToItems(lyricists, rawRelations as unknown[] | undefined);

  return { id: "lyricists", title: "Lyricists", items };
}

function buildProducers(recording: unknown): Section | null {
  if (typeof recording !== "object" || recording === null) return null;

  const credits = (recording as { credits?: unknown }).credits;
  if (typeof credits !== "object" || credits === null) return null;

  const producers = (credits as { producers?: unknown }).producers;
  const rawRelations = (recording as { _rawRelations?: unknown })._rawRelations;
  if (!Array.isArray(producers)) return null;

  const items = stringsToItems(producers, rawRelations as unknown[] | undefined);

  return { id: "producers", title: "Producers", items };
}

function buildEngineers(recording: unknown): Section | null {
  if (typeof recording !== "object" || recording === null) return null;

  const credits = (recording as { credits?: unknown }).credits;
  if (typeof credits !== "object" || credits === null) return null;

  const engineers = (credits as { recording_engineers?: unknown })
    .recording_engineers;
  const rawRelations = (recording as { _rawRelations?: unknown })._rawRelations;
  if (!Array.isArray(engineers)) return null;

  const items = stringsToItems(engineers, rawRelations as unknown[] | undefined);

  return { id: "engineers", title: "Engineers", items };
}

function buildMixingEngineers(recording: unknown): Section | null {
  if (typeof recording !== "object" || recording === null) return null;

  const credits = (recording as { credits?: unknown }).credits;
  if (typeof credits !== "object" || credits === null) return null;

  const mixingEngineers = (credits as { mixing_engineers?: unknown })
    .mixing_engineers;
  const rawRelations = (recording as { _rawRelations?: unknown })._rawRelations;
  if (!Array.isArray(mixingEngineers)) return null;

  const items = stringsToItems(mixingEngineers, rawRelations as unknown[] | undefined);

  return { id: "mixingEngineers", title: "Mixing Engineers", items };
}

function buildMasteringEngineers(recording: unknown): Section | null {
  if (typeof recording !== "object" || recording === null) return null;

  const credits = (recording as { credits?: unknown }).credits;
  if (typeof credits !== "object" || credits === null) return null;

  const masteringEngineers = (credits as { mastering_engineers?: unknown })
    .mastering_engineers;
  const rawRelations = (recording as { _rawRelations?: unknown })._rawRelations;
  if (!Array.isArray(masteringEngineers)) return null;

  const items = stringsToItems(masteringEngineers, rawRelations as unknown[] | undefined);

  return { id: "masteringEngineers", title: "Mastering Engineers", items };
}

function decodeHtmlEntities(text: string): string {
  const textarea = document.createElement("textarea");
  textarea.innerHTML = text;
  return textarea.value;
}

function stringsToItems(names: string[], rawRelations?: unknown[]): Item[] {
  return names
    .map((name) => decodeHtmlEntities(name.trim()))
    .filter(Boolean)
    .map((name) => ({
      primary: name,
      mbid: findArtistMbid(name, rawRelations),
    }));
}

function performersToItems(p: { name: string; role: string }[], rawRelations?: unknown[]): Item[] {
  return p
    .filter((x) => {
      // Filter out descriptive phrases that aren't actual performer names
      // These are sentences like "Produced by...", "Written by...", etc.
      const name = x.name.toLowerCase();
      const descriptivePhrases = [
        "produced by",
        "written by",
        "composed by",
        "recorded by",
        "mixed by",
        "mastered by",
        "arranged by",
        "arrangement by",
        "programming by",
        "effects by",
      ];
      return !descriptivePhrases.some((phrase) => name.includes(phrase));
    })
    .map((x) => {
      let name = x.name;
      let role = x.role ?? "";

      // Check if the name contains a colon separator
      // Format can be either:
      // - "Guitar: Esbjörn Öhrwall" (instrument: person) from external data
      // - "Michael Jackson: lead vocals" (person: role) from some sources
      const colonMatch = name.match(/^([^:]+):(.+)$/);
      if (colonMatch) {
        const beforeColon = colonMatch[1].trim();
        const afterColon = colonMatch[2].trim();

        // If role is empty or generic "personnel", assume format is "Instrument: Person"
        if (!role || role.toLowerCase() === "personnel") {
          role = beforeColon;  // Instrument becomes the role
          name = afterColon;   // Person becomes the name
        } else {
          // Otherwise assume format is "Person: Role"
          name = beforeColon;
          role = afterColon;
        }
      }

      // Rules:
      // - If the role looks like "instrument (trumpet)" or "vocalist (vocals)", use ONLY the parenthetical part.
      // - If there is NO parenthetical part (e.g. "vocals"), leave it unchanged.
      // - If the role is "background (vocalist)", keep "background" (outer is non-generic).
      const raw = role.trim();
      if (!raw || raw.toLowerCase() === "personnel") {
        return {
          primary: decodeHtmlEntities(name),
          mbid: findArtistMbid(name, rawRelations),
        };
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
        primary: decodeHtmlEntities(name),
        secondary: cleanedRole.length > 0 ? decodeHtmlEntities(cleanedRole) : undefined,
        mbid: findArtistMbid(name, rawRelations),
      };
    });
}
