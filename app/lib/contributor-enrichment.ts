/**
 * Manual enrichment for contributors with incomplete MusicBrainz data
 *
 * This file provides additional credits for session musicians and contributors
 * whose work is not fully documented in MusicBrainz. Data is sourced from
 * Discogs, album liner notes, and other reliable sources.
 */

export interface EnrichmentCredit {
  title: string;
  artist: string;
  year?: number;
  roles: string[];
  source: 'discogs' | 'liner-notes' | 'verified';
}

export interface ContributorEnrichment {
  mbid: string;
  name: string;
  additionalCredits: EnrichmentCredit[];
}

/**
 * Known contributors with manually-verified additional credits
 */
export const CONTRIBUTOR_ENRICHMENTS: Record<string, ContributorEnrichment> = {
  // Chad Royce - Drummer, producer, arranger
  // Source: Discogs profile and album liner notes
  'c4ff4e49-c33e-4a93-89ed-956dd76f4d18': {
    mbid: 'c4ff4e49-c33e-4a93-89ed-956dd76f4d18',
    name: 'Chad Royce',
    additionalCredits: [
      // Swimmer band (Maverick Records, ~1998-1999)
      {
        title: 'Special Life',
        artist: 'Swimmer',
        year: 1999,
        roles: ['drums (drum set)'],
        source: 'discogs',
      },
      {
        title: 'Dumb',
        artist: 'Swimmer',
        year: 1999,
        roles: ['drums (drum set)'],
        source: 'discogs',
      },
      {
        title: 'Playing Jesus',
        artist: 'Swimmer',
        year: 1999,
        roles: ['drums (drum set)'],
        source: 'discogs',
      },
      {
        title: 'Sick Friend',
        artist: 'Swimmer',
        year: 1999,
        roles: ['drums (drum set)'],
        source: 'discogs',
      },
      {
        title: 'Surreal',
        artist: 'Swimmer',
        year: 1999,
        roles: ['drums (drum set)'],
        source: 'discogs',
      },
      {
        title: "That Ol' G Minor Thing Again",
        artist: 'Swimmer',
        year: 1999,
        roles: ['drums (drum set)'],
        source: 'discogs',
      },
      {
        title: 'Pound for a Brown',
        artist: 'Swimmer',
        year: 1999,
        roles: ['drums (drum set)'],
        source: 'discogs',
      },
      {
        title: 'Undercover Junkie',
        artist: 'Swimmer',
        year: 1999,
        roles: ['drums (drum set)'],
        source: 'discogs',
      },
      {
        title: '5 Seed and Feeble',
        artist: 'Swimmer',
        year: 1999,
        roles: ['drums (drum set)'],
        source: 'discogs',
      },
      {
        title: 'Godmeat',
        artist: 'Swimmer',
        year: 1999,
        roles: ['drums (drum set)'],
        source: 'discogs',
      },
      // Red Betty - Sister Rubber Limbs (1998)
      {
        title: 'Sister Rubber Limbs',
        artist: 'Red Betty',
        year: 1998,
        roles: ['drums (drum set)'],
        source: 'discogs',
      },
      // Darediablo albums
      {
        title: 'Bedtime Stories',
        artist: 'Darediablo',
        year: 2002,
        roles: ['drums (drum set)'],
        source: 'discogs',
      },
      {
        title: 'Feeding Frenzy',
        artist: 'Darediablo',
        year: 2003,
        roles: ['drums (drum set)'],
        source: 'discogs',
      },
      {
        title: 'Twenty Paces',
        artist: 'Darediablo',
        year: 2005,
        roles: ['drums (drum set)'],
        source: 'discogs',
      },
      // Anika Moa - Thinking Room (2001)
      {
        title: 'Thinking Room',
        artist: 'Anika Moa',
        year: 2001,
        roles: ['drums (drum set)'],
        source: 'discogs',
      },
    ],
  },
};

/**
 * Get additional credits for a contributor by MBID
 */
export function getContributorEnrichment(mbid: string): ContributorEnrichment | null {
  return CONTRIBUTOR_ENRICHMENTS[mbid] || null;
}
