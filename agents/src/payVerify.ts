import "dotenv/config";
import { encodePayment, PaymentPayload, PaymentRequirements, X402_VERSION } from "./x402.js";

const ENDPOINT = process.env.X402_ENDPOINT ?? "http://localhost:4021/verify";
const PAYER = process.env.X402_PAYER ?? process.env.CONSUMER_PUBLIC_KEY ?? "";

// Builds the X-PAYMENT payload for a 402 challenge. In live mode against the Casper
// facilitator this is where a Casper x402 signer authorizes the payment; the demo
// carries the offered amount and a nonce, which the local facilitator settles.
function buildPayment(reqs: PaymentRequirements): PaymentPayload {
  return {
    x402Version: X402_VERSION,
    scheme: reqs.scheme,
    network: reqs.network,
    payload: { from: PAYER, amount: reqs.maxAmountRequired, asset: reqs.asset, nonce: String(Date.now()) },
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
