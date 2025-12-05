import { NextResponse } from "next/server";
import { lookupRecording } from "@/lib/musicbrainz";
import { normalizeRecording } from "@/lib/openai";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json(
      { error: "Missing 'id' query parameter" },
      { status: 400 }
    );
  }

  try {
    const raw = await lookupRecording(id);
    const clean = await normalizeRecording(raw);
    return NextResponse.json(clean);
  } catch (err) {
    console.error("Recording error:", err);
    return NextResponse.json(
      { error: "Failed to fetch recording details" },
      { status: 500 }
    );
  }
}
