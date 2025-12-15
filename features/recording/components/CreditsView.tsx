import Link from "next/link";

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
}: {
  data: NormalizedRecording | null;
  loading: boolean;
  enhancing?: boolean;
  error: string | null;
}) {
  const vm = buildCreditsViewModel(data?.credits);
  return (
    <>
      <div className="flex items-center justify-between">
        <Link href="/">
          <Button
            variant="outline"
            className="border-2 border-primary text-primary bg-background/75 shadow-sm"
          >
            Back
          </Button>
        </Link>
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
                  <CreditList items={section.items} />
                </CreditsSection>
              ))}
            </div>

            {/* Background enhancement (data shown, still fetching richer credits) */}
            {enhancing ? (
              <div className="flex items-center justify-center gap-2 pt-2 text-xs text-muted-foreground">
                <RecordSpinner size={18} className="opacity-90" />
                <span>Fetching more credits…</span>
              </div>
            ) : null}
          </div>
        </div>
      )}
    </>
  );
}
