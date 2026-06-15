export interface FeedInput {
  modelId: string;
  prompt: string;
  payload: unknown;
}

export interface VerifyResult {
  hash: string;
  attested: boolean;
  signer?: string;
  trusted?: boolean;
  source?: "chain" | "cspr.cloud";
  explorer?: string;
  note?: string;
  error?: string;
}

export const SAMPLE_FEED: FeedInput = {
  modelId: "claude-opus-4-8",
  prompt: "price PARK-NOTE-001",
  payload: { asset: "PARK-NOTE-001", fairValueUsd: 1284000, confidence: 0.82 }
};
