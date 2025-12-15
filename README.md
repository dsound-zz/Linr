## LINR

LINR is a small Next.js app that turns a free-form song query into either:

- **A canonical match** (when the query is sufficiently specific, e.g. includes an artist), or
- **An honest ambiguous set** of plausible songs (when the query is under-specified)

It’s built on **MusicBrainz** (primary data source), with **optional Wikipedia enrichment** and **optional OpenAI normalization/reranking**.

### What’s in here

- **Search pipeline** (`/api/search` → `app/lib/search/*`): MusicBrainz search + normalization + filters + scoring + entity-aware result assembly.
- **Recording details** (`/api/recording`): MusicBrainz recording lookup + cover art selection + credits derivation + optional enrichment.
- **Credits pipeline** (`app/lib/credits/*`): MusicBrainz credits merged with Wikipedia gap-filling into UI-friendly sections.

---

## Quickstart

### Prerequisites

- Node.js + npm

### Install

```bash
npm install
```

### Run

```bash
npm run dev
```

Open `http://localhost:3000`.

---

## Environment variables

Create a `.env.local` in the repo root.

### Optional: OpenAI

If set, LINR will:

- **normalize** recording details in `/api/recording` (`app/lib/openai.ts`),
- **optionally infer** additional credits (toggleable via query param), and
- **optionally rerank** close search candidates (`app/lib/search/openai.ts`).

```bash
OPENAI_API_KEY=...
# Optional (default: gpt-4o-mini)
OPENAI_MODEL=gpt-4o-mini
```

### Optional: Upstash Redis cache

If set, cache entries persist across restarts/instances; otherwise caching is in-memory only.

```bash
UPSTASH_REDIS_REST_URL=...
UPSTASH_REDIS_REST_TOKEN=...
```

---

## API

### `GET /api/search?q=...`

Returns either `mode: "canonical"` or `mode: "ambiguous"`.

```bash
curl "http://localhost:3000/api/search?q=jump%20van%20halen"
curl "http://localhost:3000/api/search?q=jump"
```

Debug mode includes per-stage diagnostics:

```bash
curl "http://localhost:3000/api/search?q=jump&debug=1"
```

### `GET /api/recording?id=<musicbrainz-recording-mbid>&source=musicbrainz`

Returns a normalized recording object including cover art URLs, locations, and credits.

```bash
curl "http://localhost:3000/api/recording?id=<MBID>&source=musicbrainz"
```

Controls:

- **Inferred credits** (OpenAI): enabled by default when `OPENAI_API_KEY` is set.
  - Disable with `&inferred=0`.

---

## Project structure (high level)

- `pages/`
  - Pages Router entrypoints for UI (`/`, `/recording/[id]`).
- `app/api/`
  - Next.js route handlers for APIs (`/api/search`, `/api/recording`).
- `app/lib/search/`
  - Canonical search pipeline (MusicBrainz queries, normalization, filters, ranking, result assembly).
- `app/lib/credits/`
  - Credits extraction + Wikipedia gap-fill + merging/sorting.
- `features/`
  - Feature-first UI components (search + recording views).
- `styles/`
  - Global styles and theme tokens.

---

## Logging

During development, LINR writes JSONL logs into `logs/` (best-effort; failures won’t break requests).

- `logs/search.jsonl`
- `logs/credits.jsonl`
- `logs/musicbrainz.jsonl`

---

## Scripts

```bash
npm run dev
npm run build
npm run start
npm run lint
npm test
```

---

## Notes

- **MusicBrainz user agent**: `app/lib/musicbrainz.ts` sets the MusicBrainz client `appName/appVersion/appContactInfo`. You should replace the placeholder contact info with something real to be a good API citizen.
- **Wikipedia**: used as best-effort enrichment (search validation/inference under strict conditions, and personnel/credits gap-filling). Expect occasional misses.
