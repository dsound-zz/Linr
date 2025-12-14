import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/router";

import type { NormalizedRecording } from "@/lib/types";
import { AppLayout } from "@components/layout/app-layout";
import { Button } from "@components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@components/ui/tabs";

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
        <div className="flex items-center justify-between">
          <Link href="/">
            <Button variant="outline">Back</Button>
          </Link>
        </div>

        {loading && (
          <div className="text-sm text-muted-foreground">Loading…</div>
        )}
        {error && <div className="text-sm text-destructive">{error}</div>}

        {data && (
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold tracking-tight">
              {data.title}
            </h1>
            <div className="text-sm text-muted-foreground">{data.artist}</div>
            <div className="text-xs text-muted-foreground">
              {data.release?.title ? `${data.release.title}` : ""}
              {data.release?.date ? ` — ${data.release.date}` : ""}
            </div>

            <Tabs defaultValue="raw" className="mt-4">
              <TabsList>
                <TabsTrigger value="raw">Raw</TabsTrigger>
                <TabsTrigger value="credits">Credits</TabsTrigger>
              </TabsList>

              <TabsContent value="raw">
                <pre className="mt-3 overflow-x-auto rounded-md border border-border bg-muted p-3 text-xs">
                  {JSON.stringify(data, null, 2)}
                </pre>
              </TabsContent>

              <TabsContent value="credits">
                <pre className="mt-3 overflow-x-auto rounded-md border border-border bg-muted p-3 text-xs">
                  {JSON.stringify(data.credits, null, 2)}
                </pre>
              </TabsContent>
            </Tabs>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
