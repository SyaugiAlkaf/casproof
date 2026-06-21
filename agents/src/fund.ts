import "dotenv/config";
import sdk from "casper-js-sdk";
import { rpc, loadKey, network, explorerTxUrl } from "./casper.js";
import { modelAgents } from "./producer.js";

const { NativeTransferBuilder } = sdk;

const PER_SIGNER_MOTES = process.env.FUND_PER_SIGNER_MOTES ?? "50000000000"; // 50 CSPR
const TRANSFER_PAYMENT = Number(process.env.TRANSFER_PAYMENT_MOTES ?? 100_000_000);

// Distributes gas from the funded producer/owner key to the other quorum signers, so the
// human only has to fund one account. Agent 0 is the owner (= sender) and is skipped.
async function main() {
  const sender = loadKey(process.env.PRODUCER_KEY_PATH ?? "./keys/producer_secret_key.pem");
  const targets = modelAgents().slice(1);
  if (targets.length === 0) {
    console.log("no additional signers to fund");
    return;
  }
  for (const agent of targets) {
    const target = loadKey(agent.keyPath).publicKey;
    const tx = new NativeTransferBuilder()
      .from(sender.publicKey)
      .target(target)
      .amount(PER_SIGNER_MOTES)
      .id(1)
      .chainName(network)
      .payment(TRANSFER_PAYMENT)
      .build();
    tx.sign(sender);
    console.log(`funding ${agent.modelId} (${agent.keyPath}) with ${Number(PER_SIGNER_MOTES) / 1e9} CSPR ...`);
    const res = await rpc.putTransaction(tx);
    const txHash = res.transactionHash.transactionV1?.toHex() ?? "";
    const info = await rpc.waitForTransaction(tx, 180_000);
    const err = info.executionInfo?.executionResult?.errorMessage;
    console.log(err ? `  FAILED: ${err}` : `  ok: ${explorerTxUrl(txHash)}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
