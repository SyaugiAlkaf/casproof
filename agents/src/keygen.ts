import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import sdk from "casper-js-sdk";

const { PrivateKey, KeyAlgorithm } = sdk;

async function main() {
  const out = process.argv[2] ?? "./keys/producer_secret_key.pem";
  if (existsSync(out)) {
    throw new Error(`${out} already exists — refusing to overwrite a key (pass a different path to make another)`);
  }
  const key = await PrivateKey.generate(KeyAlgorithm.ED25519);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, key.toPem(), { mode: 0o600 });

  console.log("secret key written:", out, "(gitignored — never commit it)");
  console.log("public key  :", key.publicKey.toHex());
  console.log("account hash:", key.publicKey.accountHash().toPrefixedString());
  console.log("\nFund this PUBLIC KEY once at the testnet faucet: https://testnet.cspr.live/tools/faucet");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
