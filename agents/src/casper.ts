import "dotenv/config";
import { readFileSync } from "node:fs";

const NODE_URL = process.env.CASPER_CHAIN_RPC ?? process.env.CASPER_NODE_URL!;
const NETWORK = process.env.CASPER_NETWORK_NAME ?? "casper-test";
const CONTRACT_HASH = process.env.REGISTRY_CONTRACT_HASH ?? "";

export interface OnChainAttestation {
  signer: string;
  modelId: string;
  promptHash: string;
  timestamp: number;
}

// SDK-facing layer. casper-js-sdk v5 is pinned and wired here on Day 1;
// keeping every chain call in this one module so the agents stay SDK-agnostic.
export interface CasperClient {
  loadKey(pemPath: string): Promise<KeyHandle>;
  attest(key: KeyHandle, outputHash: string, modelId: string, promptHash: string): Promise<string>;
  verify(outputHash: string): Promise<OnChainAttestation | null>;
  isTrusted(signer: string): Promise<boolean>;
}

export interface KeyHandle {
  publicKeyHex: string;
  pemPath: string;
}

export function loadKeyPath(pemPath: string): string {
  return readFileSync(pemPath, "utf8");
}

export const config = { NODE_URL, NETWORK, CONTRACT_HASH };

export function assertConfigured() {
  if (!NODE_URL) throw new Error("CASPER_CHAIN_RPC / CASPER_NODE_URL not set");
  if (!CONTRACT_HASH) throw new Error("REGISTRY_CONTRACT_HASH not set (deploy the contract first)");
}
