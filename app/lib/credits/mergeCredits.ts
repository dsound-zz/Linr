/**
 * mergeCredits.ts
 *
 * Merges credits from multiple sources with deduplication.
 * Prefers higher confidence sources.
 */

import type { Credit, CreditRole } from "./types";
import { normalizeName } from "./normalizeCredits";

/**
 * Create a deduplication key for a credit
 */
function creditKey(credit: Credit): string {
  const normalizedName = normalizeName(credit.name).toLowerCase();
  return `${credit.role}::${normalizedName}`;
}

/**
 * Merge two credits with the same role and name
 * Prefers higher confidence, preserves provenance
 */
function mergeDuplicateCredits(credit1: Credit, credit2: Credit): Credit {
  // Prefer higher confidence
  if (credit1.confidence >= credit2.confidence) {
    return {
      ...credit1,
      // Merge instrument if one has it and the other doesn't
      instrument: credit1.instrument || credit2.instrument,
      // Add note if sources differ
      notes:
        credit1.source !== credit2.source
          ? `Verified from ${credit1.source} and ${credit2.source}`
          : credit1.notes,
    };
  }

  return {
    ...credit2,
    instrument: credit2.instrument || credit1.instrument,
    notes:
      credit1.source !== credit2.source
        ? `Verified from ${credit2.source} and ${credit1.source}`
        : credit2.notes,
  };
}

/**
 * Merge credits from multiple sources
 * Deduplicates by (role + name), prefers higher confidence
 */
export function mergeCredits(...creditArrays: Credit[][]): Credit[] {
  const creditMap = new Map<string, Credit>();

  for (const credits of creditArrays) {
    for (const credit of credits) {
      const key = creditKey(credit);

      const existing = creditMap.get(key);
      if (existing) {
        // Merge duplicate
        creditMap.set(key, mergeDuplicateCredits(existing, credit));
      } else {
        // New credit
        creditMap.set(key, credit);
      }
    }
  }

  return Array.from(creditMap.values());
}

/**
 * Sort credits by role priority and name
 */
export function sortCredits(credits: Credit[]): Credit[] {
  const rolePriority: Record<CreditRole, number> = {
    producer: 1,
    co_producer: 2,
    writer: 3,
    composer: 4,
    lyricist: 5,
    arranger: 6,
    conductor: 7,
    mixer: 8,
    recording_engineer: 9,
    mastering_engineer: 10,
    performer: 11,
    featured_artist: 12,
    art_direction: 13,
    cover_art: 14,
    photography: 15,
  };

  return [...credits].sort((a, b) => {
    const priorityA = rolePriority[a.role] || 99;
    const priorityB = rolePriority[b.role] || 99;

    if (priorityA !== priorityB) {
      return priorityA - priorityB;
    }

    // Same role, sort by name
    return a.name.localeCompare(b.name);
  });
}
