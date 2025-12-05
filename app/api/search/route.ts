// app/api/search/route.ts
import { NextResponse } from "next/server";
import { searchRecordingsByTitle } from "@/lib/musicbrainz";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q");

  if (!q || q.trim().length === 0) {
    return NextResponse.json(
      { error: "Missing query parameter 'q'" },
      { status: 400 }
    );
  }

  try {
    const results = await searchRecordingsByTitle(q.trim(), 10);
    return NextResponse.json(results);
  } catch (err) {
    console.error("Search error:", err);
    return NextResponse.json({ error: "Search failed" }, { status: 500 });
  }
}
