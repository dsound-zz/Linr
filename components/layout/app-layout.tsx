import * as React from "react";

import { ThemeToggle } from "@components/theme-toggle";
import { cn } from "@/lib/utils";
import { surface } from "@styles/typeography";

export function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={cn(surface.page, "flex flex-col")}>
      <header className="border-b-2 border-border bg-card/60 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
          <div
            className={cn(
              "text-2xl font-semibold tracking-tight",
              "text-primary",
            )}
          >
            Linr
          </div>
          <ThemeToggle />
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
        {children}
      </main>
      <footer className="border-t-2 border-border bg-card/40">
        <div className="mx-auto w-full max-w-3xl px-4 py-4 text-xs text-muted-foreground">
          Built with MusicBrainz, Wikipedia, and human judgment.
        </div>
      </footer>
    </div>
  );
}
