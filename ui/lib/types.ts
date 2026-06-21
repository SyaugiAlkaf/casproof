export interface FeedInput {
  modelId: string;
  prompt: string;
  payload: unknown;
}

export interface QuorumInfo {
  reached: boolean;
  winningHash: string | null;
  agreement: number;
  threshold: number;
  matchesWinner: boolean;
}

export interface VerifyResult {
  hash: string;
  attested: boolean;
  signer?: string;
  trusted?: boolean;
  source?: "chain" | "cspr.cloud";
  explorer?: string;
  quorum?: QuorumInfo;
  note?: string;
  error?: string;
}

export interface RwaPayload {
  asset: string;
  fairValueUsd: number;
  confidence: number;
}

// Must byte-match agents/src/producer.ts valuate(RWA_INPUTS) (14_200 * 30 * 3 rounded to 1k) to hash to real registry state.
export const GENUINE_PAYLOAD: RwaPayload = {
  asset: "PARK-NOTE-001",
  fairValueUsd: 1_278_000,
  confidence: 0.82
};

export const RWA_PROMPT =
  "Value a tokenized parking-garage revenue note. Inputs: asset PARK-NOTE-001, " +
  "occupancy 78%, daily gross $14,200, 30-day trailing.";

export const SAMPLE_FEED: FeedInput = {
  modelId: "claude-opus-4-8",
  prompt: RWA_PROMPT,
  payload: GENUINE_PAYLOAD
};
