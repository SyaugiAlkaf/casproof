import "dotenv/config";
import { readFileSync } from "node:fs";
import sdk from "casper-js-sdk";
import { rpc, loadKey, network } from "./casper.js";

const { Args, CLValue, Key, SessionBuilder } = sdk;

const WASM_PATH = process.env.VAULT_WASM_PATH ?? "../contract/wasm/PayoutVault.wasm";
const INSTALL_PAYMENT = Number(process.env.INSTALL_PAYMENT_MOTES ?? 400_000_000_000);
const PACKAGE_KEY = "casproof_vault_package_hash";
const REGISTRY_PACKAGE_HASH = (process.env.REGISTRY_PACKAGE_HASH ?? "").replace(/^(hash-|package-)/, "");

async function main() {
  if (!REGISTRY_PACKAGE_HASH) {
    throw new Error("REGISTRY_PACKAGE_HASH not set — run `npm run resolve` and copy the registry package hash");
  }
  const key = loadKey(process.env.PRODUCER_KEY_PATH ?? "./keys/producer_secret_key.pem");
  const wasm = new Uint8Array(readFileSync(WASM_PATH));

  const tx = new SessionBuilder()
    .wasm(wasm)
    .installOrUpgrade()
    .runtimeArgs(
      Args.fromMap({
        odra_cfg_package_hash_key_name: CLValue.newCLString(PACKAGE_KEY),
        odra_cfg_allow_key_override: CLValue.newCLValueBool(true),
        odra_cfg_is_upgradable: CLValue.newCLValueBool(true),
        odra_cfg_is_upgrade: CLValue.newCLValueBool(false),
        registry: CLValue.newCLKey(Key.newKey(`hash-${REGISTRY_PACKAGE_HASH}`)),
      })
    )
    .from(key.publicKey)
    .chainName(network)
    .payment(INSTALL_PAYMENT)
    .build();

  tx.sign(key);
  console.log(`deploying PayoutVault (${wasm.length} bytes) wired to registry hash-${REGISTRY_PACKAGE_HASH} ...`);
  const res = await rpc.putTransaction(tx);
  console.log("submitted:", JSON.stringify((res as { transactionHash?: unknown }).transactionHash));
  await rpc.waitForTransaction(tx, 300_000);

  console.log("\ninstalled. resolve the vault contract hash with `npm run resolve:vault`, or on cspr.live:");
  console.log(`  account  : ${key.publicKey.accountHash().toPrefixedString()}`);
  console.log(`  named key: ${PACKAGE_KEY}  ->  copy the contract hash into VAULT_CONTRACT_HASH`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
