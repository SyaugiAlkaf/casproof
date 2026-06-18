import "dotenv/config";
import { AgentOutput, outputHash } from "./attest.js";
import { findAttestation, isTrusted } from "./casper.js";

export interface VerifyResult {
  ok: boolean;
  reason: string;
  signer?: string;
  source?: string;
}

// The consumer is a DeFi agent about to release a payout against the feed. It refuses
// unless the feed's hash is attested on-chain. The registry gates attest() to trusted
// signers, so an attestation existing on-chain already proves a trusted signer wrote it;
// TRUSTED_SIGNERS is an optional extra allow-list the consumer can narrow trust with.
export async function verify(feed: AgentOutput): Promise<VerifyResult> {
  const hash = outputHash(feed);
  const record = await findAttestation(hash);
  if (!record) return { ok: false, reason: "no attestation on-chain for this output (tampered or unattested)" };
  if (!isTrusted(record.signer))
    return { ok: false, reason: `attested by a signer outside this consumer's allow-list: ${record.signer}`, signer: record.signer, source: record.source };
  return { ok: true, reason: `attested on-chain by a registry-trusted signer (${record.source})`, signer: record.signer, source: record.source };
}

export function releasePayout(feed: AgentOutput): string {
  const v = (feed.payload as { fairValueUsd: number }).fairValueUsd;
  return `payout released for ${v} USD`;
}
