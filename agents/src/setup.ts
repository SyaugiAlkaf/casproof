import "dotenv/config";
import { existsSync } from "node:fs";
import { loadKey, setQuorum, setTrusted } from "./casper.js";
import { modelAgents } from "./producer.js";

// One-time, owner-only: set the k-of-n threshold and onboard every model agent's key as a
// trusted signer. Run after deploy + resolve, once REGISTRY_CONTRACT_HASH is set in .env.
async function main() {
  const ownerKey = loadKey(process.env.PRODUCER_KEY_PATH ?? "./keys/producer_secret_key.pem");
  const threshold = Number(process.env.QUORUM_THRESHOLD ?? 3);
  const agents = modelAgents();

  console.log(`setting quorum threshold to ${threshold} (of ${agents.length} model agents) ...`);
  const q = await setQuorum(ownerKey, threshold);
  console.log("  set_quorum tx:", q.explorer);

  // Agent 0 is the deployer/owner and is trusted at init; onboard the rest.
  for (const agent of agents.slice(1)) {
    if (!existsSync(agent.keyPath)) {
      console.log(`  skip ${agent.modelId}: key missing at ${agent.keyPath} (run keygen:quorum and fund it)`);
      continue;
    }
    const accountHash = loadKey(agent.keyPath).publicKey.accountHash().toPrefixedString();
    console.log(`trusting ${agent.modelId} (${accountHash}) ...`);
    const t = await setTrusted(ownerKey, accountHash, true);
    console.log("  set_trusted tx:", t.explorer);
  }
  console.log("\nsetup complete — the quorum panel is trusted and the threshold is live.");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
