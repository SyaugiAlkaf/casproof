import "dotenv/config";
import { produceFeed } from "./producer.js";
import { outputHash, promptHash } from "./attest.js";
import { attest, findAttestation, loadKey, explorerTxUrl, releaseVault } from "./casper.js";
import { verify, releasePayout } from "./consumer.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitForIndex(hash: string, tries = 12) {
  for (let i = 0; i < tries; i++) {
    if (await findAttestation(hash)) return true;
    await sleep(3000);
  }
  return false;
}

async function main() {
  console.log("── Casproof demo ─────────────────────────────────────────");
  console.log("1. producer agent generates an RWA valuation");
  const feed = await produceFeed();
  const oh = outputHash(feed);
  console.log("   payload:", JSON.stringify(feed.payload));
  console.log("   hash   :", oh);

  console.log("\n2. producer attests it on-chain");
  const key = loadKey(process.env.PRODUCER_KEY_PATH ?? "./keys/producer_secret_key.pem");
  const r = await attest(key, oh, feed.modelId, promptHash(feed.prompt));
  console.log("   tx     :", r.txHash);
  console.log("   cost   :", r.cost, "motes");
  console.log("   explorer:", r.explorer);
  process.stdout.write("   waiting for the attestation to be visible on-chain ");
  const indexed = await waitForIndex(oh);
  console.log(indexed ? "✓" : "(timeout — continuing)");

  console.log("\n3. consumer (DeFi payout agent) verifies the genuine feed");
  const good = await verify(feed);
  console.log("  ", good.ok ? `PASS → ${releasePayout(feed)}` : `BLOCK → ${good.reason}`);

  console.log("\n4. attacker poisons the feed (same source, swapped valuation)");
  const poisoned = { ...feed, payload: { ...(feed.payload as object), fairValueUsd: 999999 } };
  console.log("   poisoned hash:", outputHash(poisoned));
  const bad = await verify(poisoned);
  console.log("  ", bad.ok ? `PASS → ${releasePayout(poisoned)}` : `BLOCK → ${bad.reason}`);

  if (process.env.VAULT_CONTRACT_HASH) {
    console.log("\n5. on-chain verify-gate: a DeFi vault releases only if the registry confirms it");
    const beneficiary = key.publicKey.accountHash().toPrefixedString();
    const authorized = await releaseVault(key, oh, beneficiary);
    console.log("   genuine  →", authorized.authorized ? "PAYOUT AUTHORIZED" : `unexpected revert: ${authorized.reason}`);
    console.log("   tx       :", authorized.explorer);
    const blocked = await releaseVault(key, outputHash(poisoned), beneficiary);
    console.log("   poisoned →", blocked.authorized ? "UNEXPECTED PAYOUT" : "REVERTED on-chain (NotAttested)");
    console.log("   tx       :", blocked.explorer);
    console.log("   the Casper VM refused the payout — no off-chain agent could override it.");
  }

  console.log("\n──────────────────────────────────────────────────────────");
  if (good.ok && !bad.ok) {
    console.log("DEMO OK: genuine feed paid out, poisoned feed refused.");
    console.log("verify the on-chain attestation:", explorerTxUrl(r.txHash));
  } else {
    console.log("DEMO FAILED:", !good.ok ? "genuine feed was blocked" : "poisoned feed was accepted");
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
