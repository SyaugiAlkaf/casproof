import "dotenv/config";
import { AgentOutput, outputHash } from "./attest.js";

export interface VerifyResult {
  ok: boolean;
  reason: string;
}

// The consumer is a DeFi agent about to release a payout against the feed.
// It refuses unless the feed's hash is attested on-chain by a trusted signer.
export async function gate(
  feed: AgentOutput,
  lookup: (hash: string) => Promise<{ signer: string } | null>,
  isTrusted: (signer: string) => Promise<boolean>
): Promise<VerifyResult> {
  const hash = outputHash(feed);
  const record = await lookup(hash);
  if (!record) return { ok: false, reason: "no attestation for this output (possibly tampered)" };
  if (!(await isTrusted(record.signer)))
    return { ok: false, reason: `attested by untrusted signer ${record.signer}` };
  return { ok: true, reason: "attestation valid, signer trusted" };
}

export function releasePayout(feed: AgentOutput): string {
  const v = (feed.payload as { fairValueUsd: number }).fairValueUsd;
  return `payout released for ${v} USD`;
}
