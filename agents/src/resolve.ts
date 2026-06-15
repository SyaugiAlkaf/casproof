import "dotenv/config";
import { rpc, loadKey } from "./casper.js";

const PACKAGE_KEY = "casproof_registry_package_hash";

function firstMatch(value: unknown, re: RegExp): string {
  return (JSON.stringify(value).match(re) ?? [])[0] ?? "";
}

async function main() {
  const key = loadKey(process.env.PRODUCER_KEY_PATH ?? "./keys/producer_secret_key.pem");
  const account = key.publicKey.accountHash().toPrefixedString();
  console.log("producer account:", account);

  let pkg = "";
  try {
    const res = await rpc.queryLatestGlobalState(account, [PACKAGE_KEY]);
    pkg = firstMatch(res, /(package-[0-9a-f]{64}|hash-[0-9a-f]{64})/i);
    console.log(`named key ${PACKAGE_KEY}:`, pkg || "(not found)");
  } catch (e) {
    console.log("could not read account named keys:", (e as Error).message);
  }

  if (pkg) {
    try {
      const res = await rpc.queryLatestGlobalState(pkg, []);
      const contract = firstMatch(
        res,
        /(entity-contract-[0-9a-f]{64}|addressable-entity-[0-9a-f]{64}|contract-[0-9a-f]{64})/i
      );
      const bare = contract.replace(/^(entity-contract-|addressable-entity-|contract-)/, "");
      if (bare) {
        console.log("latest contract hash:", bare);
        console.log(`\nset in .env:\nREGISTRY_CONTRACT_HASH=${bare}`);
        return;
      }
      console.log("package resolved but no contract version parsed; raw package state:");
      console.log(JSON.stringify(res.rawJSON ?? res, null, 2).slice(0, 1500));
    } catch (e) {
      console.log("could not read package:", (e as Error).message);
    }
  }

  console.log(
    `\nfallback: open ${account} on https://testnet.cspr.live → Named Keys → ${PACKAGE_KEY} → open the package → copy the contract hash into REGISTRY_CONTRACT_HASH`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
