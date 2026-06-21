import "dotenv/config";
import { loadKey, slashSigner } from "./casper.js";

// Owner action: penalise a signer that diverged or colluded.
async function main() {
  const accountHash = process.argv[2];
  if (!accountHash) throw new Error("usage: npm run slash -- <account-hash-...>");
  const owner = loadKey(process.env.PRODUCER_KEY_PATH ?? "./keys/producer_secret_key.pem");
  const r = await slashSigner(owner, accountHash);
  console.log("slashed:", accountHash);
  console.log("tx:", r.explorer);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
