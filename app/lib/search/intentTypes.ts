import type { CanonicalResult } from "./types";

export interface ContributorIntentCandidate {
  id: string;
  name: string;
  disambiguation?: string | null;
  score: number;
}

export interface ContributorIntentResult {
  candidates: ContributorIntentCandidate[];
}

export type IntentSearchResponse =
  | { intent: "recording"; recordingId: string }
  | { intent: "contributor"; contributorId: string; contributorName: string }
  | {
      intent: "ambiguous";
      recordings: CanonicalResult[];
      contributors: ContributorIntentCandidate[];
    };
