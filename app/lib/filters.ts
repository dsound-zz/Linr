export function recordingMatchesArtist(rec: any, artistName: string): boolean {
  const ac = rec["artist-credit"] ?? [];

  const normalizedTarget = artistName.toLowerCase();

  return ac.some((entry: any) => {
    const name =
      entry?.artist?.name ??
      entry?.name ??
      (typeof entry === "string" ? entry : "");

    return name.toLowerCase().includes(normalizedTarget);
  });
}
