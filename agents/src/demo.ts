import "dotenv/config";
import { outputHash } from "./attest.js";
import { loadKey, readQuorum, readAgreement, explorerTxUrl, requestId } from "./casper.js";
import { produceFeed, runQuorum, modelAgents, RWA_PROMPT, RWA_INPUTS } from "./producer.js";
import { autonomousRelease } from "./consumer.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const agents = modelAgents();
  const reqId = process.env.REQUEST_ID ?? requestId(RWA_PROMPT, Date.now().toString(36));

  console.log("── Casproof: multi-model quorum integrity demo ───────────────");
  console.log(`request ${reqId} — valuing ${RWA_INPUTS.asset} with ${agents.length} independent model agents\n`);

  console.log(`1. ${agents.length} model agents independently value the note and attest on-chain`);
  const attestations = await runQuorum(reqId, agents);
  const hashes = new Set(attestations.map((a) => a.outputHash));
  const genuineHash = attestations[0].outputHash;
  console.log(
    hashes.size === 1
      ? `   → all ${agents.length} agents agreed on ${genuineHash.slice(0, 24)}…`
      : `   → agents diverged into ${hashes.size} hashes (no quorum will form)`
  );

  console.log("\n2. the registry tallies distinct signers and forms quorum in the VM");
  let quorum: string | null = null;
  for (let i = 0; i < 8 && !quorum; i++) {
    quorum = await readQuorum(reqId);
    if (!quorum) await sleep(3000);
  }
  const agreed = await readAgreement(reqId, genuineHash).catch(() => 0);
  console.log(
    quorum
      ? `   → QUORUM REACHED (${agreed}/${agents.length} agree) on ${quorum.slice(0, 24)}…`
      : "   → quorum not yet visible via state read (the vault still enforces it in-VM)"
  );

  const consumerKey = loadKey(process.env.CONSUMER_KEY_PATH ?? "./keys/consumer_secret_key.pem");
  const beneficiary = consumerKey.publicKey.accountHash().toPrefixedString();
  const genuineFeed = await produceFeed(agents[0].modelId);

  console.log("\n3. autonomous consumer releases the payout against the genuine output");
  const paid = await autonomousRelease(reqId, genuineFeed, beneficiary, { tries: 4 });
  console.log(`   → ${paid.decision}: ${paid.reason}`);
  if (paid.explorer) console.log(`   tx: ${paid.explorer}`);

  console.log("\n4. an attacker poisons the feed (one byte changed) and retries the payout");
  const poisonedFeed = await produceFeed(agents[0].modelId, { tamper: true });
  console.log(`   poisoned hash ${outputHash(poisonedFeed).slice(0, 24)}… ≠ quorum hash`);
  const blocked = await autonomousRelease(reqId, poisonedFeed, beneficiary, { tries: 1 });
  console.log(`   → ${blocked.decision}: ${blocked.reason}`);
  if (blocked.explorer) console.log(`   tx: ${blocked.explorer}`);

  console.log("\n──────────────────────────────────────────────────────────");
  if (paid.decision === "PAY" && blocked.decision === "BLOCK") {
    console.log("DEMO OK: quorum-attested output paid out; poisoned output reverted on-chain.");
    console.log("attestation tx:", explorerTxUrl(attestations[0].txHash));
  } else {
    console.log(`DEMO FAILED: genuine=${paid.decision}, poisoned=${blocked.decision}`);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
