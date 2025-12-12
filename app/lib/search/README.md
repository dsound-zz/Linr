# Canonical Song Search Pipeline

A clean, maintainable, testable pipeline for finding the most culturally recognized studio version of a song.

## Architecture

The pipeline is organized into focused modules, each with a single responsibility:

### 1. **search.ts** (~80 lines)
Responsible ONLY for querying MusicBrainz. No filtering, no heuristics.

**Functions:**
- `searchByTitle(title, limit)` - Search recordings by title
- `searchByTitleAndArtist(title, artist)` - Search by title and artist
- `searchArtist(name)` - Search for an artist

### 2. **normalize.ts** (~50 lines)
Converts raw MusicBrainz recordings into a normalized internal shape.

**Output format:**
```typescript
{
  id: string;
  title: string;
  artist: string;
  releases: [{ title, year, country, primaryType, secondaryTypes }];
  lengthMs: number | null;
  score: number | null; // MusicBrainz search score
}
```

### 3. **filters.ts** (~120 lines)
SMALL, STRICT filters only. No fuzzy logic.

**Filters:**
- `isExactOrPrefixTitleMatch` - Title must match exactly or be a prefix
- `isStudioRecording` - Filters out live, remix, demo, karaoke, etc.
- `isAlbumOrSingleRelease` - Must have Album or Single release
- `isUSOrWorldwideRelease` - Prefer US/worldwide releases

### 4. **rank.ts** (~100 lines)
ONE scoring function: `scoreRecording(recording, { title, artist? })`

**Scoring factors:**
- Exact title match: +40
- Prefix title match: +30
- Contains title: +20
- Artist match (if supplied): +25
- Studio recording: +10
- US/worldwide release: +5
- Album release: +10
- Single release: +5
- Earliest release year: older songs get slight boost
- MusicBrainz score: light weight (raw score / 10)

### 5. **canonical.ts** (~130 lines)
Takes a list of normalized recordings and:
- Deduplicates by title + artist (keeps highest score)
- Keeps earliest release per recording
- Sorts by score
- Returns TOP 1 (or top N)

**Function:** `canonicalPick(recordings, limit)`

### 6. **wikipedia.ts** (OPTIONAL, ~100 lines)
Used ONLY if:
- result confidence is low
- or query is single-word and ambiguous

**Purpose:** Validate mainstream recognition (NOT used for filtering)

### 7. **openai.ts** (OPTIONAL, ~80 lines)
Used ONLY if:
- multiple candidates remain close in score

**Task:** Choose most culturally recognized studio recording
**Input:** CLEAN (max 5 candidates)

### 8. **pipeline.ts** (~190 lines)
Main orchestrator that implements the exact flow:

1. Parse user query → `{ title, artist? }`
2. If artist provided:
   - `searchByTitleAndArtist` → `normalize` → `filters` → `rank` → `canonicalPick`
   - Return early if confident
3. Else (title only):
   - `searchByTitle` → `normalize` → `filters` → `rank` → `canonicalPick`
4. If confidence < threshold:
   - Try Wikipedia validation OR OpenAI rerank
5. Return canonical result

## Pipeline Flow

```
User Query
    ↓
Parse Query (title, artist?)
    ↓
┌─────────────────────────────────────┐
│ Search MusicBrainz                  │
│ - searchByTitle() OR                │
│ - searchByTitleAndArtist()          │
└─────────────────────────────────────┘
    ↓
┌─────────────────────────────────────┐
│ Normalize                            │
│ - Convert to internal format         │
└─────────────────────────────────────┘
    ↓
┌─────────────────────────────────────┐
│ Apply Strict Filters                 │
│ - isExactOrPrefixTitleMatch         │
│ - isStudioRecording                  │
│ - isAlbumOrSingleRelease             │
└─────────────────────────────────────┘
    ↓
┌─────────────────────────────────────┐
│ Score & Sort                         │
│ - scoreRecording()                  │
│ - Sort by score (descending)         │
└─────────────────────────────────────┘
    ↓
┌─────────────────────────────────────┐
│ Canonical Pick                       │
│ - Deduplicate by title+artist        │
│ - Keep earliest release              │
│ - Return top N                       │
└─────────────────────────────────────┘
    ↓
┌─────────────────────────────────────┐
│ Optional Enhancement                 │
│ - Wikipedia validation (if low conf) │
│ - OpenAI rerank (if scores close)    │
└─────────────────────────────────────┘
    ↓
Canonical Result
```

## Usage

```typescript
import { searchCanonicalSong } from "@/lib/search";

const result = await searchCanonicalSong("jump van halen");

if (result) {
  console.log(result.title);      // "Jump"
  console.log(result.artist);     // "Van Halen"
  console.log(result.year);        // "1984"
  console.log(result.source);      // "musicbrainz" | "musicbrainz+wikipedia" | "musicbrainz+openai"
  console.log(result.confidenceScore);
}
```

## Example Test Cases

### 1. "jump"
**Expected:** Should return the most culturally recognized "Jump" (likely Van Halen's 1984 hit)

### 2. "jump van halen"
**Expected:** Should return Van Halen's "Jump" from 1984

### 3. "hallelujah"
**Expected:** Should return Leonard Cohen's original "Hallelujah" (not covers)

### 4. "smells like teen spirit"
**Expected:** Should return Nirvana's "Smells Like Teen Spirit" from Nevermind (1991)

## Design Principles

1. **Single Responsibility** - Each module does ONE thing
2. **No Heuristics in Search** - Search module only queries MusicBrainz
3. **Strict Filters** - Filters are boolean predicates, no fuzzy logic
4. **Clear Scoring** - One scoring function with transparent factors
5. **Minimal Fallbacks** - Wikipedia and OpenAI used sparingly
6. **Testable** - Each module can be tested independently

## Non-Goals

- ❌ No personnel inference during search
- ❌ No deep Wikipedia HTML parsing
- ❌ No repeated-title heuristics ("jump jump jump") — handled via scoring
- ❌ No multi-pass reinsertion logic
- ❌ No dominance-collapse logic
- ❌ No infinite fallbacks

## File Structure

```
app/lib/search/
├── types.ts          # Core data types
├── search.ts         # MusicBrainz queries only
├── normalize.ts      # Normalization to internal format
├── filters.ts        # Strict boolean filters
├── rank.ts           # Scoring function
├── canonical.ts      # Deduplication and top-N selection
├── wikipedia.ts      # Optional Wikipedia validation
├── openai.ts         # Optional OpenAI reranking
├── pipeline.ts       # Main orchestrator
├── index.ts          # Public API exports
└── README.md         # This file
```
