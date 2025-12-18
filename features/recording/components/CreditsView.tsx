import { useRouter } from "next/router";

import type { NormalizedRecording } from "@/lib/types";
import { cn } from "@/lib/utils";
import { RecordSpinner } from "@components/record-spinner";
import { Button } from "@components/ui/button";
import buildCreditsViewModel from "./credits/viewModel";
import CreditsSection from "./credits/CreditsSection";
import CreditList from "./credits/CreditList";
import { surface, text } from "@styles/typeography";

export default function CreditsView({
  data,
  loading,
  enhancing,
  error,
  fromContributor,
  recordingId,
}: {
  data: NormalizedRecording | null;
  loading: boolean;
  enhancing?: boolean;
  error: string | null;
  fromContributor?: string;
  recordingId?: string;
}) {
  const router = useRouter();
  // Pass the full data object so viewModel can access _rawRelations for MBID extraction
  const vm = buildCreditsViewModel(data);

  const backText = fromContributor
    ? `Back to ${fromContributor}`
    : "Back";

  const handleBack = () => {
    // Use router.back() to properly sync with browser history
    router.back();
  };

  return (
    <>
      <div className="flex items-center justify-between">
        <Button
          variant="outline"
          className="border-2 border-primary text-primary bg-background/75 shadow-sm"
          onClick={handleBack}
        >
          {backText}
        </Button>
      </div>

      {/* Initial load (no data yet) */}
      {loading && !data && (
        <div className="flex items-center gap-3 rounded-2xl border-2 border-border bg-card p-4">
          <RecordSpinner size={28} />
          <div className={text.body}>Loading…</div>
        </div>
      )}
      {error && <div className="text-sm text-destructive">{error}</div>}

      {data && (
        <div className="space-y-4">
          <section className={cn(surface.cardPadded, "space-y-2")}>
            <div className="flex items-start gap-4">
              {data.coverArtThumbUrl || data.coverArtUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={(data.coverArtThumbUrl ?? data.coverArtUrl) as string}
                  alt={
                    data.release?.title
                      ? `${data.release.title} cover`
                      : "Cover art"
                  }
                  width={96}
                  height={96}
                  className="h-24 w-24 shrink-0 rounded-2xl border-2 border-border object-cover"
                  onError={(e) => {
                    e.currentTarget.style.display = "none";
                  }}
                />
              ) : null}

              <div className="min-w-0 space-y-2">
                <h1
                  className={cn(
                    "text-2xl font-semibold tracking-tight",
                    "text-primary",
                  )}
                >
                  {data.title}
                </h1>
                <div className={cn(text.body, "text-muted-foreground")}>
                  {data.artist}
                </div>
                <div className={text.meta}>
                  {data.release?.title ? `${data.release.title}` : ""}
                  {data.release?.date ? ` — ${data.release.date}` : ""}
                </div>
              </div>
            </div>
          </section>

          <div className="space-y-3">
            <div className={text.sectionTitle}>Credits</div>
            <div className="space-y-4">
              {vm.sections.map((section) => (
                <CreditsSection key={section.id} title={section.title}>
                  <CreditList
                    items={section.items}
                    songContext={
                      data
                        ? {
                            title: data.title || "Unknown",
                            artist: data.artist || "Unknown",
                            recordingId,
                          }
                        : undefined
                    }
                    sectionRole={section.id}
                  />
                </CreditsSection>
              ))}
            </div>

            {/* Background enhancement (data shown, still fetching richer credits) */}
            {enhancing ? (
              <div
                className={cn(
                  surface.cardPadded,
                  "mt-3 flex items-center justify-center gap-3 border-primary/40 bg-secondary/40",
                )}
              >
                <RecordSpinner size={28} className="opacity-95" showTonearm />
                <div className="space-y-0.5">
                  <div className="text-sm font-semibold text-foreground">
                    Fetching more credits…
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Album personnel and additional contributors
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}
    </>
  );
}
