import "dotenv/config";

const FACILITATOR = process.env.X402_FACILITATOR_URL ?? "https://x402-facilitator.cspr.cloud";
const NETWORK = process.env.X402_NETWORK ?? "casper:casper-test";
const CSPR_CLOUD_KEY = process.env.CSPR_CLOUD_API_KEY ?? "";
const PAY_TO = process.env.X402_PAY_TO ?? "";
const ASSET = process.env.X402_ASSET ?? "CSPR";
const PRICE_MOTES = process.env.X402_PRICE_MOTES ?? "100000000";

// "live" settles each read through the hosted Casper facilitator; "sim" runs the
// 402 handshake locally for development. The verification read it gates is always real.
export const X402_MODE = (process.env.X402_MODE ?? "live").toLowerCase();
export const X402_VERSION = 1;

export interface PaymentRequirements {
  scheme: string;
  network: string;
  maxAmountRequired: string;
  resource: string;
  description: string;
  mimeType: string;
  payTo: string;
  maxTimeoutSeconds: number;
  asset: string;
  extra?: Record<string, unknown>;
}

export interface PaymentPayload {
  x402Version: number;
  scheme: string;
  network: string;
  payload: Record<string, unknown>;
}

export interface VerifyResponse {
  isValid: boolean;
  invalidReason?: string;
  payer?: string;
}

export interface SettleResponse {
  success: boolean;
  transaction?: string;
  network?: string;
  payer?: string;
  errorReason?: string;
}

export function paymentRequirements(resource: string): PaymentRequirements {
  return {
    scheme: "exact",
    network: NETWORK,
    maxAmountRequired: PRICE_MOTES,
    resource,
    description: "Casproof metered attestation verification",
    mimeType: "application/json",
    payTo: PAY_TO,
    maxTimeoutSeconds: 120,
    asset: ASSET,
  };
}

export function challenge(resource: string) {
  return { x402Version: X402_VERSION, error: "payment required", accepts: [paymentRequirements(resource)] };
}

export function encodePayment(p: PaymentPayload): string {
  return Buffer.from(JSON.stringify(p)).toString("base64");
}

export function decodePayment(header: string): PaymentPayload {
  return JSON.parse(Buffer.from(header, "base64").toString("utf8")) as PaymentPayload;
}

export function settlementHeader(s: SettleResponse): string {
  return Buffer.from(JSON.stringify(s)).toString("base64");
}

async function facilitatorPost<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(`${FACILITATOR}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: CSPR_CLOUD_KEY },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`facilitator ${path} ${r.status}: ${await r.text()}`);
  return (await r.json()) as T;
}

export function facilitatorVerify(payload: PaymentPayload, reqs: PaymentRequirements): Promise<VerifyResponse> {
  return facilitatorPost<VerifyResponse>("/verify", { x402Version: X402_VERSION, paymentPayload: payload, paymentRequirements: reqs });
}

export function facilitatorSettle(payload: PaymentPayload, reqs: PaymentRequirements): Promise<SettleResponse> {
  return facilitatorPost<SettleResponse>("/settle", { x402Version: X402_VERSION, paymentPayload: payload, paymentRequirements: reqs });
}

export async function facilitatorSupported(): Promise<unknown> {
  const r = await fetch(`${FACILITATOR}/supported`, { headers: { authorization: CSPR_CLOUD_KEY } });
  if (!r.ok) throw new Error(`facilitator /supported ${r.status}: ${await r.text()}`);
  return r.json();
}
