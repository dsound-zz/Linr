"use client";

import * as React from "react";
import Link from "next/link";
import { UserCircle } from "lucide-react";
import { useSession } from "next-auth/react";

import { ThemeToggle } from "@components/theme-toggle";
import { cn } from "@/lib/utils";
import { surface } from "@styles/typeography";

export function AppLayout({ children }: { children: React.ReactNode }) {
  const { data: session } = useSession();
  const isAuthed = Boolean(session?.user?.id);

  return (
    <div className={cn(surface.page, "flex flex-col")}>
      <header className="border-b-2 border-border bg-card/60 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
          <Link
            href="/search"
            className={cn(
              "text-2xl font-semibold tracking-tight",
              "text-primary",
            )}
          >
            Linr
          </Link>
          <div className="flex items-center gap-2">
            <Link
              href={isAuthed ? "/profile" : "/api/auth/signin"}
              className={cn(
                "inline-flex h-10 w-10 items-center justify-center rounded-full border border-border bg-background/70 text-muted-foreground",
                "hover:text-foreground hover:bg-muted/50",
              )}
              title={isAuthed ? "Profile" : "Sign in"}
            >
              {session?.user?.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={session.user.image}
                  alt={session.user.name ?? "Profile"}
                  className="h-9 w-9 rounded-full object-cover"
                  width={36}
                  height={36}
                />
              ) : (
                <UserCircle className="h-6 w-6" />
              )}
            </Link>
            <ThemeToggle />
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
        {children}
      </main>
      <footer className="border-t-2 border-border bg-card/40">
        <div className="mx-auto w-full max-w-3xl px-4 py-4 text-xs text-muted-foreground">
          Built with MusicBrainz, Wikipedia, Discogs, OpenAI and Human Judgement{" "}
          <a
            href="https://www.demiansims.com"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary underline"
          >
            demiansims.com
          </a>
        </div>
      </footer>
    </div>
  );
}
