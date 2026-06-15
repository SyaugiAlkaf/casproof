import "dotenv/config";
import { readFileSync } from "node:fs";
import sdk from "casper-js-sdk";
import { rpc, loadKey, network } from "./casper.js";

const { Args, CLValue, SessionBuilder } = sdk;

const WASM_PATH = process.env.WASM_PATH ?? "../contract/wasm/AttestationRegistry.wasm";
const INSTALL_PAYMENT = Number(process.env.INSTALL_PAYMENT_MOTES ?? 400_000_000_000);
const PACKAGE_KEY = "casproof_registry_package_hash";

async function main() {
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
      })
    )
    .from(key.publicKey)
    .chainName(network)
    .payment(INSTALL_PAYMENT)
    .build();

  tx.sign(key);
  console.log(`deploying ${WASM_PATH} (${wasm.length} bytes) to ${network} ...`);
  const res = await rpc.putTransaction(tx);
  console.log("submitted:", JSON.stringify((res as { transactionHash?: unknown }).transactionHash));
  await rpc.waitForTransaction(tx, 300_000);

  console.log("\ninstalled. find the contract hash under your account's named keys:");
  console.log(`  named key: ${PACKAGE_KEY}  ->  resolve its latest contract version`);
  console.log(`  account  : ${key.publicKey.accountHash().toString()}`);
  console.log("on cspr.live (testnet): open your account → Named Keys → copy the contract hash");
  console.log("then set REGISTRY_CONTRACT_HASH in .env");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
