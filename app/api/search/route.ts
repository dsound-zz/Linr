import { NextResponse } from "next/server";
import {
  searchArtistByName,
  searchGlobalRecordings,
  searchRecordingsByTitleForArtist,
} from "@/lib/musicbrainz";
import { recordingMatchesArtist } from "@/lib/filters";
import { parseUserQuery } from "@/lib/parseQuery"; // title + artist splitter
import { normalizeRecording } from "@/lib/normalize";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q");
  if (!q) return NextResponse.json({ error: "Missing q" }, { status: 400 });

  const { title, artist } = parseUserQuery(q);

  // 1. If user typed an artist → try scoped search
  if (artist) {
    const artistMatch = await searchArtistByName(artist);

    if (artistMatch) {
      const scoped = await searchRecordingsByTitleForArtist(
        title,
        artistMatch.id
      );

      // FILTER HERE
      const filtered = scoped.filter((rec) =>
        recordingMatchesArtist(rec, artistMatch.name)
      );

      if (filtered.length > 0) {
        return NextResponse.json({ results: filtered.map(normalizeRecording) });
      }
    }
  }

  // 2. Fallback: global search
  const global = await searchGlobalRecordings(title);

  return NextResponse.json({ results: global });
}
