import "dotenv/config";
import { AgentOutput, outputHash } from "./attest.js";
import { loadKey, readQuorum, readAgreement, releaseVault, requestId } from "./casper.js";
import { RWA_PROMPT } from "./producer.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface VerifyResult {
  ok: boolean;
  reason: string;
  quorumHash?: string | null;
  agreement?: number;
}

// Off-chain read: is this feed the quorum-attested result for its request? Used by the
// dashboard and tests. The on-chain vault is the authoritative gate (see autonomousRelease).
export async function verify(feed: AgentOutput, reqId: string): Promise<VerifyResult> {
  const hash = outputHash(feed);
  const quorumHash = await readQuorum(reqId);
  if (!quorumHash) return { ok: false, reason: "no quorum reached for this request yet", quorumHash: null };
  const agreement = await readAgreement(reqId, hash);
  if (quorumHash !== hash)
    return { ok: false, reason: "this output is not the quorum-attested result (tampered or under-quorum)", quorumHash, agreement };
  return { ok: true, reason: "quorum-attested by independent agents", quorumHash, agreement };
}

export interface ConsumerDecision {
  decision: "PAY" | "BLOCK";
  reason: string;
  quorumHash: string | null;
  txHash?: string;
  explorer?: string;
}

// The autonomous DeFi consumer. No human in the trust path: it polls the on-chain quorum
// status, then calls PayoutVault.release. The Casper VM authorizes the payout only if the
// presented output is the quorum-attested result; a poisoned/under-quorum feed reverts
// on-chain. Either outcome is a real, verifiable testnet transaction.
export async function autonomousRelease(
  reqId: string,
  feed: AgentOutput,
  beneficiaryAccountHash: string,
  opts: { keyPath?: string; tries?: number; intervalMs?: number } = {}
): Promise<ConsumerDecision> {
  const key = loadKey(opts.keyPath ?? process.env.CONSUMER_KEY_PATH ?? "./keys/consumer_secret_key.pem");
  const hash = outputHash(feed);
  const tries = opts.tries ?? 20;
  const intervalMs = opts.intervalMs ?? 3000;

  let quorumHash: string | null = null;
  for (let i = 0; i < tries; i++) {
    quorumHash = await readQuorum(reqId);
    if (quorumHash) break;
    await sleep(intervalMs);
  }

  // Attempt the release regardless of the off-chain read — the contract is the source of
  // truth. A genuine, quorum-attested output is authorized; anything else reverts on-chain.
  const r = await releaseVault(key, reqId, hash, beneficiaryAccountHash);
  if (r.authorized) {
    return { decision: "PAY", reason: "quorum-attested — payout authorized on-chain", quorumHash, txHash: r.txHash, explorer: r.explorer };
  }
  return {
    decision: "BLOCK",
    reason: `release reverted on-chain (${r.reason ?? "no quorum"}) — funds withheld`,
    quorumHash,
    txHash: r.txHash,
    explorer: r.explorer,
  };
}

export function releasePayout(feed: AgentOutput): string {
  const v = (feed.payload as { fairValueUsd: number }).fairValueUsd;
  return `payout released for ${v} USD`;
}

async function main() {
  const reqId = process.env.REQUEST_ID ?? requestId(RWA_PROMPT, "live");
  const key = loadKey(process.env.CONSUMER_KEY_PATH ?? "./keys/consumer_secret_key.pem");
  const beneficiary = key.publicKey.accountHash().toPrefixedString();
  const { produceFeed } = await import("./producer.js");
  const feed = await produceFeed("claude-opus-4-8");
  console.log(`consumer watching request ${reqId} (hash ${outputHash(feed).slice(0, 16)}…)`);
  const decision = await autonomousRelease(reqId, feed, beneficiary);
  console.log(`${decision.decision}: ${decision.reason}`);
  if (decision.explorer) console.log("tx:", decision.explorer);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
