# Canonical Song Search API Development Journey

**Date:** December 13, 2025  
**Project:** LINR - Music Entity Resolution Search Pipeline

## Executive Summary

This document chronicles the development of a canonical song search API built on MusicBrainz, Wikipedia, and OpenAI. The journey involved multiple architectural pivots, debugging sessions, and iterative refinements to achieve reliable, culturally-aware song identification.

**Final Architecture:** A multi-stage pipeline with explicit entity types (`recording`, `album_track`, `song_inferred`), score-gap-based canonical selection, and comprehensive fallback mechanisms.

---

## The Core Problem

### Initial State
- Overgrown, monolithic search backend
- Unreliable results for single-word queries (e.g., "jump")
- No distinction between recordings, album tracks, and inferred songs
- Premature canonicalization leading to wrong results
- Missing culturally significant songs (e.g., "The Dude" by Quincy Jones)

### Requirements
1. **Reliability:** Return the most culturally recognized studio version of a song
2. **Modularity:** Clean, maintainable, testable pipeline
3. **Type Safety:** Fully typed TypeScript with clear interfaces
4. **Ambiguity Handling:** Distinguish between canonical (single result) and ambiguous (multiple results) queries
5. **Entity Awareness:** Explicitly model different entity types (recordings vs album tracks)

---

## Major Challenges & Solutions

### 1. Single-Word Query Ambiguity

**Problem:** Queries like "jump" returned novelty songs, children's songs, or phrase matches instead of canonical hits like Van Halen's "Jump".

**Failed Approaches:**
- ❌ **Hard filtering by word count** - Eliminated all candidates, causing oscillation between "too strict" and "too loose"
- ❌ **Wikipedia fallback as primary source** - Returned "Unknown artist" and unreliable results
- ❌ **Forcing canonical mode** - Ignored legitimate ambiguity when multiple artists had hits

**Working Solution:**
- ✅ **Exact-title search first** - Use MusicBrainz quoted syntax: `recording:"Jump"` for single-word queries
- ✅ **Score-gap threshold** - Only return canonical when `topScore - secondScore >= 5`
- ✅ **Scoring dominance** - Exact title matches get +100 boost for single-word queries
- ✅ **Penalize repeated-word titles** - "Jump Jump Jump" gets -25 penalty

**Key Code:**
```typescript
// pipeline.ts
const CANONICAL_SCORE_GAP = 5;
const shouldReturnCanonical =
  artistProvided ||
  (isSingleWordQuery && results.length === 1) ||
  (isSingleWordQuery && results.length > 1 && scoreGap >= CANONICAL_SCORE_GAP);
```

---

### 2. Album Track Discovery

**Problem:** Songs that exist primarily as album tracks (e.g., "The Dude" by Quincy Jones) never appeared in results because they weren't modeled as standalone recordings in MusicBrainz.

**Failed Approaches:**
- ❌ **Treating album tracks as recordings** - Lost entity type information, caused confusion
- ❌ **Wikipedia-only fallback** - Unreliable, missing artist information
- ❌ **Forcing canonical selection** - Over-canonicalized multi-word title-only queries

**Working Solution:**
- ✅ **Explicit `album_track` entity type** - Preserved through entire pipeline
- ✅ **Release-track fallback** - Search releases by title, extract matching tracks
- ✅ **Entity-aware scoring** - Lighter scoring for album tracks (+10 canonical artist, +5 year ≤ 1990)
- ✅ **Ambiguous-only inclusion** - Album tracks appear in ambiguous results, never auto-canonicalized

**Key Code:**
```typescript
// types.ts
export interface AlbumTrackCandidate {
  title: string;
  artist: string;
  year: string | null;
  releaseTitle: string | null;
  releaseId: string;
  confidenceScore?: number;
  source: "musicbrainz";
}

// pipeline.ts
if (!artistProvided && !isSingleWordQuery) {
  // Include album tracks in ambiguous results
  const combinedResults = [
    ...results.slice(0, 3),
    ...albumTrackResults.slice(0, 2),
  ];
}
```

---

### 3. Over-Canonicalization

**Problem:** Multi-word title-only queries (e.g., "The Dude") were forced into canonical mode even when multiple artists had legitimate hits.

**Failed Approaches:**
- ❌ **Confidence threshold alone** - Didn't account for score gaps
- ❌ **Hard-coded single-word logic** - Ignored multi-word ambiguity
- ❌ **Wikipedia inference gates** - Too permissive, created false positives

**Working Solution:**
- ✅ **Score gap threshold** - Canonical only when gap ≥ 5 points
- ✅ **Explicit entity resolution** - Step 6.5 assigns `entityType` based on source
- ✅ **Strict Wikipedia gate** - Only triggers when `!artistProvided && results.length > 0 && topResult.confidenceScore < 95 && queryLooksLikeSongTitle(title)`
- ✅ **Ambiguity for multi-word title-only** - Always ambiguous unless artist provided

**Key Code:**
```typescript
// pipeline.ts
const scoreGap = results.length > 1
  ? results[0].confidenceScore - results[1].confidenceScore
  : Infinity;

const shouldReturnCanonical =
  artistProvided ||
  (isSingleWordQuery && results.length === 1) ||
  (isSingleWordQuery && results.length > 1 && scoreGap >= CANONICAL_SCORE_GAP);
```

---

### 4. Scoring Heuristics

**Problem:** Obscure recordings outranked culturally canonical songs due to missing popularity signals.

**Failed Approaches:**
- ❌ **Hardcoded artist lists** - Brittle, incomplete
- ❌ **Wikipedia page presence** - Too slow, unreliable
- ❌ **OpenAI reranking** - Expensive, inconsistent

**Working Solution:**
- ✅ **Multi-factor scoring** - Title match (+100 exact), canonical artist (+30), studio recording (+10), US release (+5), album release (+10)
- ✅ **80s US hits boost** - Single-word exact matches, studio album, 1980-1990, US release get +40
- ✅ **Title track bonus** - Recording title matching release title gets +20
- ✅ **Age bias** - Older songs get slight boost (up to +10)
- ✅ **Light MusicBrainz score** - MB score / 10 added to final score

**Key Code:**
```typescript
// rank.ts
if (isSingleWordQuery && isExactTitleMatch) {
  if (isStudioAlbum && hasReleaseYearBetween1980And1990 && hasUSRelease) {
    score += 40; // Canonical 80s US hits boost
  }
}
```

---

### 5. Query Construction & MusicBrainz API

**Problem:** MusicBrainz token search didn't reliably return single-word titles. Queries were malformed or not preserving case.

**Failed Approaches:**
- ❌ **Broad full-text search** - Returned too many irrelevant results
- ❌ **Lowercasing quoted queries** - Lost exact match precision
- ❌ **Premature filtering** - Removed candidates before scoring

**Working Solution:**
- ✅ **Quoted exact-title search** - `recording:"Jump"` for single-word queries
- ✅ **Preserve case** - Convert to TitleCase: `title.charAt(0).toUpperCase() + title.slice(1).toLowerCase()`
- ✅ **Pagination handling** - Fetch up to 100 results across multiple pages
- ✅ **Deduplication** - By recording MBID before normalization

**Key Code:**
```typescript
// search.ts
const titleCase = title.charAt(0).toUpperCase() + title.slice(1).toLowerCase();
const query = `recording:"${titleCase}"`;
```

---

### 6. Testing & Debugging

**Problem:** No test coverage, difficult to debug pipeline behavior, large log files.

**Failed Approaches:**
- ❌ **Manual testing only** - Slow, error-prone
- ❌ **Appending to log files** - Created massive files
- ❌ **Incomplete mocks** - Tests didn't reflect real behavior

**Working Solution:**
- ✅ **Vitest test suite** - Fast, compatible with Next.js
- ✅ **Comprehensive mocks** - MusicBrainz API mocked with realistic data
- ✅ **JSONL logging** - Structured debug output, overwritten each run
- ✅ **Debug info structure** - Stages, timing, entity resolution, final selection

**Key Code:**
```typescript
// vitest.config.ts
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["**/*.test.ts", "**/*.spec.ts"],
  },
});

// pipeline.ts
if (debug) {
  debugInfo.stages.finalSelection = {
    maxResults,
    recordingsIncluded,
    albumTracksIncluded,
    albumTracksTotal,
    reason,
  };
}
```

---

## Final Architecture

### Pipeline Flow

```
1. Parse Query → { title, artist }
2. Search MusicBrainz
   - If artist: searchByTitleAndArtist
   - If single-word: searchExactRecordingTitle (quoted)
   - Else: searchByTitle (broad)
3. Normalize → NormalizedRecording[]
4. Apply Filters → Filtered recordings
5. Score & Sort → Scored recordings
6. Release Track Fallback (if needed)
   - Search releases by title
   - Extract matching tracks → AlbumTrackCandidate[]
   - Score album tracks separately
7. Entity Resolution → Assign entityType
8. Decide Response Mode
   - Canonical: score gap ≥ 5 OR artist provided OR single result
   - Ambiguous: score gap < 5 OR multi-word title-only
9. Wikipedia Validation (optional, late-stage)
10. Return Response
```

### Module Structure

```
app/lib/search/
├── pipeline.ts          # Main orchestrator
├── search.ts            # MusicBrainz queries
├── normalize.ts         # MB → NormalizedRecording
├── filters.ts           # Boolean predicates
├── rank.ts              # Scoring functions
├── canonical.ts         # Entity resolution & result assembly
├── releaseTrackFallback.ts  # Album track discovery
├── wikipedia.ts         # Wikipedia validation
├── openai.ts            # Optional reranking
├── cache.ts             # In-memory caching
├── types.ts             # Type definitions
└── __tests__/
    └── pipeline.test.ts # Unit tests
```

### Entity Types

```typescript
type CanonicalEntityType = 
  | "recording"      // Clean MusicBrainz recording
  | "album_track"    // Track inferred from album context
  | "song_inferred"; // Cultural / Wikipedia-level song
```

### Response Modes

```typescript
type SearchResponse =
  | { mode: "canonical"; result: CanonicalResult }
  | { mode: "ambiguous"; results: CanonicalResult[] };
```

---

## Key Learnings

### What Worked ✅

1. **Explicit Entity Types** - Modeling `album_track` as first-class entity prevented confusion and enabled proper handling
2. **Score Gap Threshold** - Simple numeric threshold (5 points) reliably distinguishes canonical from ambiguous
3. **Scoring Over Filtering** - Let scoring decide rather than hard filters that eliminate candidates
4. **Quoted Exact Search** - MusicBrainz quoted syntax (`recording:"Jump"`) dramatically improved single-word results
5. **Modular Architecture** - Small, focused modules (~150 lines each) made debugging and testing manageable
6. **Comprehensive Debug Logging** - JSONL logs with stage-by-stage breakdown made issues visible immediately
7. **Vitest Testing** - Fast, compatible test framework enabled regression prevention

### What Didn't Work ❌

1. **Hard Word-Count Filters** - Created oscillation between "too strict" and "too loose"
2. **Wikipedia as Primary Source** - Unreliable, missing artist info, too slow
3. **Forcing Canonical Mode** - Ignored legitimate ambiguity
4. **Collapsing Entity Types** - Lost important information about source and confidence
5. **Premature Filtering** - Removed candidates before scoring could evaluate them
6. **OpenAI Reranking** - Expensive, inconsistent, not worth the cost
7. **Appending Log Files** - Created massive files, hard to debug

### Design Principles That Emerged

1. **Explicit Over Implicit** - Entity types, response modes, score gaps all explicit
2. **Scoring Over Filtering** - Prefer scoring penalties over boolean filters
3. **Fallback Hierarchy** - Recordings → Album Tracks → Wikipedia (only if needed)
4. **Ambiguity as Feature** - Sometimes ambiguous is the correct answer
5. **Cultural Recognition** - Boost canonical artists, 80s hits, title tracks
6. **Minimal Heuristics** - Few, well-tuned scoring rules beat many ad-hoc filters

---

## Performance Optimizations

1. **In-Memory Caching** - TTL-based cache for MusicBrainz responses
2. **Parallel API Calls** - `Promise.all` for independent requests
3. **Early Exit** - Return early when high-confidence result found
4. **Pagination** - Fetch up to 100 results efficiently
5. **Deduplication** - Remove duplicates before expensive operations

---

## Remaining Challenges

1. **MusicBrainz Rate Limiting** - No built-in rate limit handling (relies on caching)
2. **Wikipedia Reliability** - Still occasionally returns "Unknown artist"
3. **OpenAI Cost** - Reranking is expensive and rarely used
4. **Test Coverage** - Some edge cases not fully covered
5. **Internationalization** - Primarily tuned for US/English music

---

## Future Improvements

1. **Rate Limit Handling** - Implement exponential backoff for MusicBrainz
2. **Wikipedia Fallback Refinement** - Better artist extraction
3. **Remove OpenAI Dependency** - Not providing value, remove to reduce complexity
4. **Expand Test Coverage** - More edge cases, integration tests
5. **International Music** - Tune scoring for non-US releases
6. **Popularity Signals** - Integrate Spotify/Apple Music popularity if available

---

## Conclusion

The journey from an overgrown monolithic backend to a clean, modular, testable pipeline required multiple architectural pivots and iterative refinements. The key breakthrough was introducing explicit entity types and score-gap-based canonical selection, which eliminated the oscillation between "too strict" and "too loose" that plagued earlier versions.

The final solution balances reliability, performance, and maintainability while handling the inherent ambiguity of music search queries. By explicitly modeling different entity types and using scoring over filtering, the pipeline can reliably surface culturally canonical songs while gracefully handling ambiguous queries.

**Key Metrics:**
- ✅ "jump" → Van Halen (canonical)
- ✅ "jump" with close scores → Multiple artists (ambiguous)
- ✅ "the dude" → Quincy Jones album track (ambiguous)
- ✅ "the dude quincy jones" → Quincy Jones recording (canonical)
- ✅ All tests passing (7/7)
- ✅ No linter errors
- ✅ Comprehensive debug logging

---

*This document serves as a reference for future development and a reminder of the lessons learned during this journey.*
