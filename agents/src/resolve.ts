import "dotenv/config";
import { rpc, loadKey } from "./casper.js";

// `npm run resolve` → registry; `npm run resolve:vault` → vault.
const TARGETS: Record<string, { packageKey: string; envVar: string; packageEnv?: string }> = {
  registry: { packageKey: "casproof_registry_package_hash", envVar: "REGISTRY_CONTRACT_HASH", packageEnv: "REGISTRY_PACKAGE_HASH" },
  vault: { packageKey: "casproof_vault_package_hash", envVar: "VAULT_CONTRACT_HASH" },
};

function firstMatch(value: unknown, re: RegExp): string {
  return (JSON.stringify(value).match(re) ?? [])[0] ?? "";
}

async function main() {
  const target = TARGETS[process.argv[2] ?? "registry"] ?? TARGETS.registry;
  const { packageKey, envVar, packageEnv } = target;

  const key = loadKey(process.env.PRODUCER_KEY_PATH ?? "./keys/producer_secret_key.pem");
  const account = key.publicKey.accountHash().toPrefixedString();
  console.log("producer account:", account);

  let pkg = "";
  try {
    const res = await rpc.queryLatestGlobalState(account, [packageKey]);
    pkg = firstMatch(res, /(package-[0-9a-f]{64}|hash-[0-9a-f]{64})/i);
    console.log(`named key ${packageKey}:`, pkg || "(not found)");
  } catch (e) {
    console.log("could not read account named keys:", (e as Error).message);
  }

  if (pkg) {
    const barePkg = pkg.replace(/^(package-|hash-)/, "");
    try {
      const res = await rpc.queryLatestGlobalState(pkg, []);
      const contract = firstMatch(
        res,
        /(entity-contract-[0-9a-f]{64}|addressable-entity-[0-9a-f]{64}|contract-[0-9a-f]{64})/i
      );
      const bare = contract.replace(/^(entity-contract-|addressable-entity-|contract-)/, "");
      if (bare) {
        console.log("latest contract hash:", bare);
        console.log("\nset in .env:");
        console.log(`${envVar}=${bare}`);
        if (packageEnv) console.log(`${packageEnv}=${barePkg}`);
        return;
      }
      console.log("package resolved but no contract version parsed; raw package state:");
      console.log(JSON.stringify(res.rawJSON ?? res, null, 2).slice(0, 1500));
    } catch (e) {
      console.log("could not read package:", (e as Error).message);
    }
  }

  console.log(
    `\nfallback: open ${account} on https://testnet.cspr.live → Named Keys → ${packageKey} → open the package → copy the contract hash into ${envVar}`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
