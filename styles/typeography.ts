export const text = {
  pageTitle: "text-3xl font-semibold tracking-tight text-primary",
  sectionTitle:
    "text-sm font-semibold uppercase tracking-wide text-muted-foreground",
  body: "text-sm text-foreground",
  meta: "text-xs text-muted-foreground",
} as const;

export const surface = {
  // Prevent tiny mobile horizontal overflows from pills/long tokens/animations.
  page: "min-h-dvh overflow-x-hidden bg-background text-foreground",
  card: "rounded-2xl border-2 border-border bg-card text-card-foreground shadow-sm",
  cardPadded:
    "rounded-2xl border-2 border-border bg-card p-4 text-card-foreground shadow-sm",
  headerStrip:
    "rounded-xl border-2 border-primary/25 bg-secondary px-3 py-2 text-sm font-semibold text-secondary-foreground",
  badge:
    "inline-flex items-center rounded-full border-2 border-accent bg-accent/25 px-2 py-0.5 text-xs font-semibold text-foreground",
  sticker:
    // Allow breaking long tokens like "musicbrainz+wikipedia".
    "inline-flex items-center break-words rounded-full border-2 border-primary/35 bg-secondary/35 px-2 py-0.5 text-xs font-semibold text-primary",
} as const;
