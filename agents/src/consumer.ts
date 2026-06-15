import "dotenv/config";
import { AgentOutput, outputHash } from "./attest.js";
import { findAttestation, isTrusted } from "./casper.js";

export interface VerifyResult {
  ok: boolean;
  reason: string;
  signer?: string;
}

// The consumer is a DeFi agent about to release a payout against the feed.
// It refuses unless the feed's hash is attested on-chain by a trusted signer.
export async function verify(feed: AgentOutput): Promise<VerifyResult> {
  const hash = outputHash(feed);
  const record = await findAttestation(hash);
  if (!record) return { ok: false, reason: "no attestation for this output (tampered or unattested)" };
  if (!isTrusted(record.signer))
    return { ok: false, reason: `attested by untrusted signer ${record.signer}`, signer: record.signer };
  return { ok: true, reason: "attestation valid, signer trusted", signer: record.signer };
}

export function releasePayout(feed: AgentOutput): string {
  const v = (feed.payload as { fairValueUsd: number }).fairValueUsd;
  return `payout released for ${v} USD`;
}
