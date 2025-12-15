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

  React.useEffect(() => {
    if (!router.isReady) return;
    if (typeof id !== "string") return;

    setLoading(true);
    setError(null);

    const params = new URLSearchParams({ id });
    if (typeof source === "string" && source) params.set("source", source);

    fetch(`/api/recording?${params.toString()}`)
      .then(async (res) => {
        const json = (await res.json()) as unknown;
        const err = (json as Record<string, unknown> | null)?.error;
        if (typeof err === "string" && err.length > 0) throw new Error(err);
        setData(json as NormalizedRecording);
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
        <CreditsView data={data} loading={loading} error={error} />
      </div>
    </AppLayout>
  );
}
