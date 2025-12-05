export function parseUserQuery(input: string): {
  title: string;
  artist: string | null;
} {
  const q = input.trim();

  // If user typed only 1 word → it's a title
  if (q.split(" ").length === 1) {
    return { title: q, artist: null };
  }

  const words = q.split(" ");

  // Try last two words as artist
  const possibleArtist = words.slice(-2).join(" ");
  const titleGuess = words.slice(0, -2).join(" ");

  // Very lightweight check:
  // If removing last 2 words leaves something meaningful → treat as (title, artist)
  if (titleGuess.length >= 2) {
    return {
      title: titleGuess,
      artist: possibleArtist,
    };
  }

  // Fallback: treat whole thing as title
  return {
    title: q,
    artist: null,
  };
}
