import "dotenv/config";
import { produceFeed } from "./producer.js";
import { outputHash } from "./attest.js";
import { attest, findAttestation, loadKey } from "./casper.js";
import { verify, releasePayout } from "./consumer.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitForIndex(hash: string, tries = 10) {
  for (let i = 0; i < tries; i++) {
    if (await findAttestation(hash)) return;
    await sleep(3000);
  }
}

async function main() {
  console.log("1. producer generates RWA valuation");
  const feed = await produceFeed();
  console.log("   ", JSON.stringify(feed.payload));

  console.log("2. producer attests it on-chain");
  const key = loadKey(process.env.PRODUCER_KEY_PATH ?? "./keys/producer_secret_key.pem");
  const tx = await attest(key, outputHash(feed), feed.modelId, "demo");
  console.log("    tx:", tx);
  await waitForIndex(outputHash(feed));

  console.log("3. consumer verifies the genuine feed");
  const good = await verify(feed);
  console.log("   ", good.ok ? `PASS → ${releasePayout(feed)}` : `BLOCK → ${good.reason}`);

  console.log("4. attacker poisons the feed (same source, swapped number)");
  const poisoned = { ...feed, payload: { ...(feed.payload as object), fairValueUsd: 999999 } };
  const bad = await verify(poisoned);
  console.log("   ", bad.ok ? `PASS → ${releasePayout(poisoned)}` : `BLOCK → ${bad.reason}`);

  console.log(bad.ok ? "\nDEMO FAILED: poisoned feed was accepted" : "\nDEMO OK: poisoned feed refused");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
