export function parseUserQuery(q: string) {
  const parts = q.trim().split(/\s+/);

  // If only one word, it's just a title
  if (parts.length === 1) {
    return { title: q.trim(), artist: null };
  }

  // If multiple words:
  // Assume last 2 words might be the artist
  // "jump van halen" → title="jump", artist="van halen"
  // "jump michael jackson" → title="jump", artist="michael jackson"
  const lastTwo = parts.slice(-2).join(" ");
  const first = parts.slice(0, -2).join(" ");

  return {
    title: first || q.trim(), // fallback
    artist: lastTwo,
  };
}
