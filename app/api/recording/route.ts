import { NextResponse } from "next/server";
import {
  lookupRecording,
  lookupRelease,
  lookupReleaseGroup,
} from "@/lib/musicbrainz";
import { normalizeRecording } from "@/lib/openai";
import { logCreditsResponse } from "@/lib/logger";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  const source = searchParams.get("source");
  // Default to inferred credits on; allow explicit opt-out with inferred=0/false
  const inferredParam = searchParams.get("inferred");
  const allowInferred =
    inferredParam == null ||
    inferredParam === "" ||
    inferredParam === "1" ||
    inferredParam.toLowerCase() === "true";

  if (!id) {
    return NextResponse.json(
      { error: "Missing 'id' query parameter" },
      { status: 400 },
    );
  }

  // Only allow MusicBrainz lookup for MusicBrainz sources
  // Allow undefined/null source for backward compatibility
  if (id.startsWith("wiki:") || (source && source !== "musicbrainz")) {
    return NextResponse.json(
      {
        error: "Lookup is only supported for MusicBrainz sources",
        id,
        source: source || null,
      },
      { status: 400 },
    );
  }

  try {
    const raw = await lookupRecording(id);

    // Pull the primary release and release-group to harvest additional relations
    const primaryRelease = raw.releases?.[0];
    const release = primaryRelease?.id
      ? await lookupRelease(primaryRelease.id)
      : null;
    const releaseGroupId =
      release?.["release-group"]?.id ??
      primaryRelease?.["release-group"]?.id ??
      null;
    const releaseGroup = releaseGroupId
      ? await lookupReleaseGroup(releaseGroupId)
      : null;

    const clean = await normalizeRecording(raw, {
      release,
      releaseGroup,
      allowInferred,
    });

    // Log last 3 credits payloads returned (summary only)
    await logCreditsResponse({ id, allowInferred, normalized: clean });
    return NextResponse.json(clean);
  } catch (err) {
    console.error("Recording error:", err);
    return NextResponse.json(
      { error: "Failed to fetch recording details" },
      { status: 500 },
    );
  }
}
