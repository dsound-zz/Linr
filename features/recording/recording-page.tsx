import * as React from "react";
import { useRouter } from "next/router";

import type { NormalizedRecording } from "@/lib/types";
import { AppLayout } from "@components/layout/app-layout";
import CreditsView from "./components/CreditsView";

export function RecordingPage() {
  const router = useRouter();
  const { id, source } = router.query;

  const [data, setData] = React.useState<NormalizedRecording | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [enhancing, setEnhancing] = React.useState(false);
  const SPARSE_PERFORMERS_THRESHOLD = 5;

  React.useEffect(() => {
    if (!router.isReady) return;
    if (typeof id !== "string") return;

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

    fetch(`/api/recording?${baseParams.toString()}`)
      .then(async (res) => {
        const json = (await res.json()) as unknown;
        const err = (json as Record<string, unknown> | null)?.error;
        if (typeof err === "string" && err.length > 0) throw new Error(err);
        const base = json as NormalizedRecording;
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
        fetch(`/api/recording?${enrichParams.toString()}`)
          .then(async (r2) => {
            const j2 = (await r2.json()) as unknown;
            const err2 = (j2 as Record<string, unknown> | null)?.error;
            if (typeof err2 === "string" && err2.length > 0) return;
            setData(j2 as NormalizedRecording);
          })
          .finally(() => setEnhancing(false));
      })
      .catch((err) => {
        setError(
          err instanceof Error ? err.message : "Failed to load recording",
        );
      })
      .finally(() => setLoading(false));
  }, [router.isReady, id, source]);

  return (
    <AppLayout>
      <div className="space-y-6">
        <CreditsView
          data={data}
          loading={loading}
          enhancing={enhancing}
          error={error}
        />
      </div>
    </AppLayout>
  );
}
