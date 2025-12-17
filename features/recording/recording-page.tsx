import * as React from "react";
import { useRouter } from "next/router";

import type { NormalizedRecording } from "@/lib/types";
import { AppLayout } from "@components/layout/app-layout";
import CreditsView from "./components/CreditsView";

const isAbortError = (err: unknown): err is DOMException =>
  err instanceof DOMException && err.name === "AbortError";

export function RecordingPage() {
  const router = useRouter();
  const { id, source, from_contributor, from_recording_id } = router.query;

  const [data, setData] = React.useState<NormalizedRecording | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [enhancing, setEnhancing] = React.useState(false);
  const SPARSE_PERFORMERS_THRESHOLD = 5;
  const requestSeq = React.useRef(0);

  React.useEffect(() => {
    if (!router.isReady) return undefined;
    if (typeof id !== "string") return undefined;

    // Guard against race conditions when navigating quickly between recordings.
    // Only the latest request is allowed to update state.
    requestSeq.current += 1;
    const seq = requestSeq.current;
    const baseAbort = new AbortController();
    const enrichAbort = new AbortController();

    setLoading(true);
    setError(null);
    setData(null);
    setEnhancing(false);

    // Fast path: render MusicBrainz-derived data quickly.
    // Then (optionally) enrich in the background.
    const baseParams = new URLSearchParams({
      id,
      ai: "0",
      external: "0",
      inferred: "0",
    });
    if (typeof source === "string" && source) baseParams.set("source", source);

    fetch(`/api/recording?${baseParams.toString()}`, {
      signal: baseAbort.signal,
    })
      .then(async (res) => {
        const json = (await res.json()) as unknown;
        const err = (json as Record<string, unknown> | null)?.error;
        if (typeof err === "string" && err.length > 0) throw new Error(err);
        const base = json as NormalizedRecording;
        if (requestSeq.current !== seq) return;
        setData(base);

        // Background enrichment (OpenAI + Wikipedia). Never block initial render.
        setEnhancing(true);
        const performersCount = base?.credits?.performers?.length ?? 0;
        const shouldInferPerformersSparse =
          performersCount > 0 && performersCount < SPARSE_PERFORMERS_THRESHOLD;
        const enrichParams = new URLSearchParams({
          id,
          ai: "1",
          external: "1",
          inferred: shouldInferPerformersSparse ? "1" : "0",
        });
        if (typeof source === "string" && source)
          enrichParams.set("source", source);
        fetch(`/api/recording?${enrichParams.toString()}`, {
          signal: enrichAbort.signal,
        })
          .then(async (r2) => {
            const j2 = (await r2.json()) as unknown;
            const err2 = (j2 as Record<string, unknown> | null)?.error;
            if (typeof err2 === "string" && err2.length > 0) return;
            if (requestSeq.current !== seq) return;
            setData(j2 as NormalizedRecording);
          })
          .catch((err) => {
            if (isAbortError(err)) return;
            if (requestSeq.current !== seq) return;
            console.error(err);
          })
          .finally(() => {
            if (requestSeq.current !== seq) return;
            setEnhancing(false);
          });
      })
      .catch((err) => {
        if (isAbortError(err)) return;
        if (requestSeq.current !== seq) return;
        setError(
          err instanceof Error ? err.message : "Failed to load recording",
        );
      })
      .finally(() => {
        if (requestSeq.current !== seq) return;
        setLoading(false);
      });

    return () => {
      baseAbort.abort();
      enrichAbort.abort();
    };
  }, [router.isReady, id, source]);

  // Determine which recording ID to pass for the back button:
  // - If we came from another recording (from_recording_id exists), use that (preserve the original)
  // - Otherwise, use the current recording's ID (this is the starting point)
  const recordingIdForBackButton = typeof from_recording_id === "string" && from_recording_id
    ? from_recording_id
    : typeof id === "string" ? id : undefined;

  return (
    <AppLayout>
      <div className="space-y-6">
        <CreditsView
          data={data}
          loading={loading}
          enhancing={enhancing}
          error={error}
          fromContributor={typeof from_contributor === "string" ? from_contributor : undefined}
          recordingId={recordingIdForBackButton}
        />
      </div>
    </AppLayout>
  );
}
