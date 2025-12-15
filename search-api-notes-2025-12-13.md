# LINR – Developer Story (Search + Recording Details + Credits)

**Date:** December 2025
**Project:** LINR – music entity resolution + “liner notes”

## Executive Summary

LINR started with a deceptively hard user expectation: *type a song query, get the culturally recognized song back.* MusicBrainz gives structured IDs and rich relationships, but real-world music data is messy: ambiguous titles (“Jump”), uneven metadata completeness, multiple competing MBIDs for the “same” song, and performance constraints from rate limits and lookup depth.

The project evolved into **three cooperating pipelines**, each with clear boundaries:

- **Search pipeline** (`/api/search`): resolve a user query into either **ambiguous** results or a single **canonical** result.
- **Recording details pipeline** (`/api/recording`): take a MusicBrainz **recording MBID** and return a normalized object (cover art + locations + credits), optionally enriched.
- **Credits pipeline** (`app/lib/credits/*`): merge MusicBrainz + Wikipedia credits into a deduped, UI-friendly structure.

The biggest product/architecture insight was treating **ambiguity as a valid outcome**, and treating “canonical” as something we only assert when the query provides identity (usually an explicit artist).

---

## The Core Problem

### Initial State

- Overgrown, monolithic backend logic with intertwined responsibilities.
- Title-only queries often forced a single answer too early.
- Missing culturally significant songs due to search blind spots.
- Slow fallbacks (too many MusicBrainz calls per query).
- Credits inconsistencies (same “song” across different MBIDs/releases yields different performer lists).

### Core Requirements

1. **Reliability**: surface culturally plausible candidates without brittle, hard-coded exceptions.
2. **Honest ambiguity**: return multiple legitimate results when the query is under-specified.
3. **Modularity + testability**: small, single-purpose modules with Vitest coverage.
4. **Type safety**: explicit entity types and normalized internal shapes.
5. **Performance**: cap lookups, cache heavily, prefer fast paths.

---

## Major Challenges & What Actually Worked

### 1) Single-Word Query Ambiguity

**Problem:** Single-word titles are inherently ambiguous; a “winner” is often a lie.

**What didn’t work:**

- Hard word-count filters (oscillated between too strict and too loose).
- Using Wikipedia as a primary search source (brittle artist extraction, inconsistent).
- Forcing canonical selection on title-only queries.

**What worked:**

- **Enforce query intent at MusicBrainz**: for single-word title-only queries, use quoted syntax: `recording:"Jump"`.
- **Score over filter**: keep candidates broad, then score for exact match + studio + release signals.
- **Return ambiguity by default** for title-only queries.

---

### 2) Album Track Discovery + Performance

**Problem:** Some culturally-known songs are easier to find as **tracks on releases** than as strong recording search hits. Naively scanning release tracklists explodes API calls.

**What didn’t work:**

- Treating tracks as recordings (lost entity identity).
- Brute-force scanning lots of releases with `lookup(release)`.

**What worked:**

- Introduce an explicit `album_track` entity type.
- Use a **fast path**: derive candidate artists from initial results, then do **artist-scoped recording search** to find likely matches.
- Keep the slow path only as a tightly bounded fallback (and for tests).

---

### 3) Over-Canonicalization (Core Product Pivot)

**Problem:** A pipeline that always returns “the canonical song” for title-only queries is inevitably wrong.

**What worked:**

- Make response mode explicit:
  - `mode: "ambiguous"` for title-only queries.
  - `mode: "canonical"` only when the user provides identity (artist disambiguation).
- Keep score gaps for *ranking + confidence*, not for “forcing” canonical on under-specified queries.

---

### 4) Query Parsing (“why can’t i”)

**Problem:** Heuristics mis-inferred an “artist” from lowercase contractions because apostrophes looked like name punctuation.

**What worked:**

- Treat apostrophes as “name punctuation” only when there’s uppercase present (e.g. “Guns N’ Roses”, not “can’t i”).

---

### 5) MusicBrainz Metadata Pitfalls (Compilations, Remasters, Variants)

**Problem:** Boolean filters can accidentally exclude canonical results (e.g. recordings that appear on compilations *and* albums).

**What worked:**

- Prefer **scoring preferences** (boost non-compilation album context) over “exclude if any compilation exists.”

---

### 6) Credits Completeness Varies by MBID

**Problem:** Different MusicBrainz recording IDs for the same “song” can have very different performer relationship completeness.

**What worked:**

- Keep search stable.
- Enrich credits at detail-time:
  - `/api/recording` can **merge performers from a few alternate MB recordings** with the same title+artist (bounded + cached) when the base performer list is sparse.

---

## Final Architecture (How LINR Works Today)

## A) Search Pipeline (`/api/search` → `searchCanonicalSong`)

**Goal:** return either:

- `mode: "ambiguous"` with the top plausible results, or
- `mode: "canonical"` with a single result when the user disambiguates.

**High-level flow:**

1. **Parse query** → `{ title, artist | null }`.
2. **Search MusicBrainz**:
   - Artist provided → `recording:"title" AND artist:"artist"`.
   - Title-only single-word → quoted exact-title search first.
   - Title-only multi-word → search across small title variants (apostrophe normalization + conservative token variants like `u/you`).
3. **Candidate discovery (multi-word title-only):**
   - derive candidate artists from results
   - run album-track discovery (fast path)
   - run artist-scoped discovery for popular candidate artists
4. **Normalize** raw recordings.
5. **Filter conservatively** (exact/prefix title match; studio + album/single unless source implies weaker metadata).
6. **Score & sort** using heuristic scoring.
7. **Assemble results** with entity awareness (`recording` vs `album_track`).
8. **Optional Wikipedia**: late-stage validation/inference under strict gates.
9. **Optional OpenAI rerank**: only for a small, already-scored candidate set.
10. **Mode decision**:
    - Title-only → `ambiguous`.
    - Artist provided → `canonical` when a single dominant work is appropriate.

---

## B) Recording Details Pipeline (`/api/recording` → `normalizeRecording`)

**Goal:** given a MusicBrainz recording MBID, return a UI-ready `NormalizedRecording` including cover art + locations + credits.

**High-level flow:**

1. `lookupRecording(mbid)`
2. Choose a **primary release** (prefer Album + not Compilation), lookup release + release-group.
3. Derive credits/locations from MusicBrainz relations (recording/release/release-group/work).
4. **Wikipedia personnel enrichment** (optional): `getWikipediaPersonnel(title, artist)`.
5. **OpenAI normalization** (optional): normalize/clean structured fields.
6. **OpenAI inferred credits** (optional): if enabled, infer missing credits conservatively.
7. **Performer enrichment** (best-effort): if performers are sparse, merge additional performers from a few alternate recording MBIDs (bounded + cached).

---

## C) Credits Pipeline (`app/lib/credits/*`)

**Goal:** merge and dedupe credits from MusicBrainz + Wikipedia into stable, role-oriented credits.

**Flow:**

1. Fetch MusicBrainz credits.
2. Normalize roles/names.
3. Detect missing roles (or treat as sparse).
4. Fetch Wikipedia credits **only for missing roles**.
5. Merge + dedupe + sort by role priority.

---

## Observability + Performance

- **Caching**: in-memory caching for MusicBrainz queries (plus targeted caching for enrichment lookups).
- **Logging**: structured JSONL logs for search and credits responses (capped / recent-only).
- **Caps + fast paths**: discovery steps are bounded to avoid runaway MusicBrainz API costs.

---

## Current Reality Check (Examples)

- `"jump"` → **ambiguous** (multiple culturally legitimate candidates).
- `"jump van halen"` → **canonical** (artist disambiguation).
- `"the dude"` → **ambiguous**, may include `album_track`.
- `"the dude quincy jones"` → **canonical**.

---

## Appendix: Where Each Data Source Fits

- **MusicBrainz**: authoritative IDs, recordings/releases, relationships → the backbone of search + credits.
- **Wikipedia**:
  - Search pipeline: late-stage validation/inference under strict gates.
  - Recording/credits: personnel extraction to fill missing roles.
- **OpenAI**:
  - Search pipeline: optional rerank of a small already-scored candidate set.
  - Recording details: normalize raw MB payload into a consistent `NormalizedRecording`, and optionally infer missing credits.
