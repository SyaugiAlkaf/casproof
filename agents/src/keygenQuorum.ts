import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import sdk from "casper-js-sdk";
import { modelAgents } from "./producer.js";

const { PrivateKey, KeyAlgorithm } = sdk;

// Generates one signing key per model agent in the quorum panel, skipping any that exist.
// Each public key must be funded once at the testnet faucet before it can attest.
async function main() {
  const agents = modelAgents();
  console.log(`quorum panel: ${agents.length} model agents\n`);
  for (const agent of agents) {
    if (existsSync(agent.keyPath)) {
      console.log(`${agent.modelId.padEnd(28)} key exists at ${agent.keyPath}`);
      continue;
    }
    const key = await PrivateKey.generate(KeyAlgorithm.ED25519);
    mkdirSync(dirname(agent.keyPath), { recursive: true });
    writeFileSync(agent.keyPath, key.toPem(), { mode: 0o600 });
    console.log(`${agent.modelId.padEnd(28)} -> ${agent.keyPath}`);
    console.log(`  public key  : ${key.publicKey.toHex()}`);
    console.log(`  account hash: ${key.publicKey.accountHash().toPrefixedString()}`);
  }
  console.log("\nFund each PUBLIC KEY once at https://testnet.cspr.live/tools/faucet (gitignored — never commit keys).");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
