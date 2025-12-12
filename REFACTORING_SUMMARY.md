# Canonical Song Search Refactoring Summary

## Overview

Successfully refactored the overgrown song search backend into a clean, maintainable, testable "Canonical Song Search" pipeline.

## New Architecture

### Folder Structure

```
app/lib/search/
├── types.ts          # Core data types (NormalizedRecording, CanonicalResult, ParsedQuery)
├── search.ts         # MusicBrainz queries only (~80 lines)
├── normalize.ts      # Normalization to internal format (~55 lines)
├── filters.ts        # Strict boolean filters (~120 lines)
├── rank.ts           # Single scoring function (~100 lines)
├── canonical.ts      # Deduplication and top-N selection (~130 lines)
├── wikipedia.ts      # Optional Wikipedia validation (~100 lines)
├── openai.ts         # Optional OpenAI reranking (~100 lines)
├── pipeline.ts       # Main orchestrator (~190 lines)
├── index.ts          # Public API exports
└── README.md         # Detailed documentation
```

## Key Modules

### 1. search.ts
- **Responsibility:** Query MusicBrainz only
- **Functions:**
  - `searchByTitle(title, limit)` - Search by title
  - `searchByTitleAndArtist(title, artist)` - Search by title and artist
  - `searchArtist(name)` - Search for artist
- **No filtering, no heuristics**

### 2. normalize.ts
- **Responsibility:** Convert MusicBrainz recordings to internal format
- **Output:** `NormalizedRecording` with structured release info

### 3. filters.ts
- **Responsibility:** Strict boolean filters
- **Filters:**
  - `isExactOrPrefixTitleMatch` - Title matching
  - `isStudioRecording` - Filter out live/remix/demo
  - `isAlbumOrSingleRelease` - Must have Album/Single
  - `isUSOrWorldwideRelease` - Prefer US/worldwide

### 4. rank.ts
- **Responsibility:** Single scoring function
- **Function:** `scoreRecording(recording, { title, artist? })`
- **Scoring factors:** Title match, artist match, studio recording, release type, year, MB score

### 5. canonical.ts
- **Responsibility:** Deduplication and top-N selection
- **Function:** `canonicalPick(recordings, limit)`
- **Process:** Deduplicate → Keep earliest release → Sort by score → Return top N

### 6. wikipedia.ts (Optional)
- **Purpose:** Validate mainstream recognition
- **Used when:** Low confidence or single-word ambiguous query
- **NOT used for filtering**

### 7. openai.ts (Optional)
- **Purpose:** Rerank close candidates
- **Used when:** Multiple candidates with close scores
- **Input:** Max 5 pre-filtered candidates

### 8. pipeline.ts
- **Responsibility:** Main orchestrator
- **Function:** `searchCanonicalSong(query)`
- **Flow:**
  1. Parse query
  2. Search MusicBrainz
  3. Normalize
  4. Apply filters
  5. Score and sort
  6. Pick canonical result
  7. Optional: Wikipedia validation or OpenAI rerank

## Pipeline Flow

```
User Query
    ↓
Parse Query (title, artist?)
    ↓
Search MusicBrainz
    ↓
Normalize to Internal Format
    ↓
Apply Strict Filters
    ↓
Score & Sort
    ↓
Canonical Pick (deduplicate, earliest release, top N)
    ↓
Optional: Wikipedia validation OR OpenAI rerank
    ↓
Canonical Result
```

## Usage

```typescript
import { searchCanonicalSong } from "@/lib/search";

const result = await searchCanonicalSong("jump van halen");
// Returns: CanonicalResult | null
```

## API Route

A new simplified route is available at `app/api/search/route.new.ts`:

```typescript
export async function GET(req: Request) {
  const q = searchParams.get("q");
  const result = await searchCanonicalSong(q);
  return NextResponse.json({ results: result ? [result] : [] });
}
```

## Test Cases

The pipeline should handle:

1. **"jump"** → Van Halen's "Jump" (1984)
2. **"jump van halen"** → Van Halen's "Jump" (1984)
3. **"hallelujah"** → Leonard Cohen's original "Hallelujah"
4. **"smells like teen spirit"** → Nirvana's "Smells Like Teen Spirit" (1991)

## Design Principles

✅ **Single Responsibility** - Each module does ONE thing  
✅ **No Heuristics in Search** - Search only queries MusicBrainz  
✅ **Strict Filters** - Boolean predicates, no fuzzy logic  
✅ **Clear Scoring** - Transparent scoring factors  
✅ **Minimal Fallbacks** - Wikipedia/OpenAI used sparingly  
✅ **Testable** - Each module can be tested independently  

## Non-Goals (Avoided)

❌ No personnel inference during search  
❌ No deep Wikipedia HTML parsing  
❌ No repeated-title heuristics  
❌ No multi-pass reinsertion logic  
❌ No dominance-collapse logic  
❌ No infinite fallbacks  

## Migration Notes

- Old route: `app/api/search/route.ts` (kept for reference)
- New route: `app/api/search/route.new.ts` (ready to use)
- Old modules: Still exist but can be deprecated after migration
- New modules: `app/lib/search/*` (clean architecture)

## Next Steps

1. Test the new pipeline with example queries
2. Compare results with old implementation
3. Migrate route.ts to use new pipeline
4. Add unit tests for each module
5. Deprecate old modules once migration is complete
