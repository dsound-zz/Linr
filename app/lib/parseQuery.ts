export function parseUserQuery(q: string) {
  const raw = q.trim();
  if (!raw) return { title: "", artist: null };

  // Explicit separators take priority
  const byMatch = raw.match(/^(.*?)\s+by\s+(.+)$/i);
  if (byMatch) {
    const [, title, artist] = byMatch;
    return { title: title.trim(), artist: artist.trim() };
  }

  const dashSplit = raw.split(/\s+[-–—]\s+/);
  if (dashSplit.length === 2 && dashSplit[1]) {
    return { title: dashSplit[0].trim(), artist: dashSplit[1].trim() };
  }

  const commaSplit = raw.split(/\s*,\s*/);
  if (commaSplit.length === 2 && commaSplit[1]) {
    return { title: commaSplit[0].trim(), artist: commaSplit[1].trim() };
  }

  const parts = raw.split(/\s+/);

  // If only one or two words, treat the whole thing as a title
  if (parts.length <= 2) {
    return { title: raw, artist: null };
  }

  // Heuristic: if the last two words look like a proper name (capitalized or containing punctuation),
  // treat them as the artist. Otherwise, keep the whole query as the title.
  const candidateArtist = parts.slice(-2).join(" ");
  const candidateTitle = parts.slice(0, -2).join(" ");
  const words = candidateArtist.split(" ");
  const looksCapitalizedName = words.every(
    (w) => w[0] && w[0] === w[0].toUpperCase(),
  );

  // Guard: some title endings are commonly capitalized but are not artists
  // (e.g., "Go On", "Hold On", "Come On"). If the candidate artist is composed
  // only of very common stop/auxiliary words, don't infer it as an artist.
  const stopWords = new Set([
    "a",
    "an",
    "and",
    "are",
    "as",
    "at",
    "be",
    "but",
    "by",
    "do",
    "for",
    "from",
    "go",
    "hold",
    "i",
    "if",
    "in",
    "into",
    "is",
    "it",
    "me",
    "my",
    "no",
    "not",
    "of",
    "on",
    "or",
    "out",
    "so",
    "the",
    "to",
    "up",
    "we",
    "will",
    "with",
    "you",
    "your",
  ]);
  const candidateWordsLower = words.map((w) => w.toLowerCase());
  const looksLikeTitleTail = candidateWordsLower.every((w) => stopWords.has(w));

  // Punctuation can indicate a proper name (e.g., "AC/DC", "Guns N' Roses"),
  // but apostrophes inside lowercase contractions (e.g., "can't") should NOT
  // trigger artist inference.
  const hasUppercase = /[A-Z]/.test(candidateArtist);
  const hasNamePunctuation =
    /[&/\.]/.test(candidateArtist) ||
    (hasUppercase && /'/.test(candidateArtist));

  const looksProperName =
    (looksCapitalizedName && !looksLikeTitleTail) || hasNamePunctuation;

  if (looksProperName) {
    return { title: candidateTitle, artist: candidateArtist };
  }

  return { title: raw, artist: null };
}
