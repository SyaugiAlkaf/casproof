import "dotenv/config";
import blakejs from "blakejs";
import { canonical } from "./attest.js";
import { loadKey } from "./casper.js";
import { encodePayment, PaymentPayload, PaymentRequirements, X402_MODE, X402_VERSION } from "./x402.js";

const ENDPOINT = process.env.X402_ENDPOINT ?? "http://localhost:4021/verify";
const PAYER = process.env.X402_PAYER ?? process.env.CONSUMER_PUBLIC_KEY ?? "";
const PAYER_KEY_PATH = process.env.X402_PAYER_KEY_PATH ?? process.env.CONSUMER_KEY_PATH ?? "./keys/consumer_secret_key.pem";

// Builds the X-PAYMENT payload for a 402 challenge. Sim mode carries the offered amount
// and a bare nonce, which the local facilitator settles. Live mode loads the payer key
// and signs a canonical authorization the hosted Casper facilitator can verify+settle.
function buildPayment(reqs: PaymentRequirements): PaymentPayload {
  if (X402_MODE !== "live") {
    return {
      x402Version: X402_VERSION,
      scheme: reqs.scheme,
      network: reqs.network,
      payload: { from: PAYER, amount: reqs.maxAmountRequired, asset: reqs.asset, nonce: String(Date.now()) },
    };
  }
  return buildSignedPayment(reqs);
}

// Stand-in until the live facilitator opens: production signs @casper-ecosystem/casper-eip-712 typed data, we sign a flat canonical-JSON digest.
function buildSignedPayment(reqs: PaymentRequirements): PaymentPayload {
  if (!reqs.payTo) throw new Error("live x402: the 402 offer has no payTo — set X402_PAY_TO on the server (default X402_MODE=sim needs none of this)");
  const key = loadKey(PAYER_KEY_PATH);
  const now = Math.floor(Date.now() / 1000);
  const authorization = {
    from: key.publicKey.toHex(),
    payTo: reqs.payTo,
    amount: reqs.maxAmountRequired,
    maxAmountRequired: reqs.maxAmountRequired,
    asset: reqs.asset,
    network: reqs.network,
    nonce: String(Date.now()),
    validAfter: now,
    validBefore: now + reqs.maxTimeoutSeconds,
  };
  const digest = blakejs.blake2bHex(canonical(authorization), undefined, 32);
  const signature = Buffer.from(key.signAndAddAlgorithmBytes(Buffer.from(digest, "hex"))).toString("hex");
  return {
    x402Version: X402_VERSION,
    scheme: reqs.scheme,
    network: reqs.network,
    payload: { ...authorization, payer: authorization.from, digest, signature },
  };
}

export async function paidVerify(hash: string): Promise<{ status: number; body: unknown }> {
  const url = `${ENDPOINT}?hash=${hash}`;
  let res = await fetch(url);
  if (res.status === 402) {
    const offer = (await res.json()) as { accepts: PaymentRequirements[] };
    const reqs = offer.accepts[0];
    console.log(`402 → paying ${reqs.maxAmountRequired} motes to ${reqs.payTo || "(payTo unset)"} on ${reqs.network}`);
    res = await fetch(url, { headers: { "x-payment": encodePayment(buildPayment(reqs)) } });
  }
  return { status: res.status, body: await res.json() };
}

async function main() {
  const hash = process.argv[2];
  if (!hash) throw new Error("usage: npm run x402:verify <outputHash>");
  const { status, body } = await paidVerify(hash);
  console.log("status:", status);
  console.log("result:", JSON.stringify(body, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
