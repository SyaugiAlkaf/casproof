import "dotenv/config";
import { readFileSync } from "node:fs";
import {
  RpcClient,
  HttpHandler,
  PrivateKey,
  KeyAlgorithm,
  Args,
  CLValue,
  ContractCallBuilder,
} from "casper-js-sdk";

const NODE_URL = process.env.CASPER_CHAIN_RPC ?? process.env.CASPER_NODE_URL!;
const NETWORK = process.env.CASPER_NETWORK_NAME ?? "casper-test";
const CONTRACT_HASH = process.env.REGISTRY_CONTRACT_HASH ?? "";
const CSPR_CLOUD = process.env.CSPR_CLOUD_BASE ?? "https://api.testnet.cspr.cloud";
const CSPR_CLOUD_KEY = process.env.CSPR_CLOUD_API_KEY ?? "";
const ATTEST_PAYMENT = Number(process.env.ATTEST_PAYMENT_MOTES ?? 3_000_000_000);
const TRUSTED = (process.env.TRUSTED_SIGNERS ?? "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

export const rpc = new RpcClient(new HttpHandler(NODE_URL));
export const network = NETWORK;

export function loadKey(pemPath: string): PrivateKey {
  const algo =
    (process.env.KEY_ALGORITHM ?? "").toLowerCase() === "secp256k1"
      ? KeyAlgorithm.SECP256K1
      : KeyAlgorithm.ED25519;
  return PrivateKey.fromPem(readFileSync(pemPath, "utf8"), algo);
}

export async function attest(
  key: PrivateKey,
  outputHash: string,
  modelId: string,
  promptHashHex: string
): Promise<string> {
  requireContract();
  const tx = new ContractCallBuilder()
    .byHash(CONTRACT_HASH)
    .entryPoint("attest")
    .runtimeArgs(
      Args.fromMap({
        output_hash: CLValue.newCLString(outputHash),
        model_id: CLValue.newCLString(modelId),
        prompt_hash: CLValue.newCLString(promptHashHex),
      })
    )
    .from(key.publicKey)
    .chainName(NETWORK)
    .payment(ATTEST_PAYMENT)
    .build();
  tx.sign(key);
  const res = await rpc.putTransaction(tx);
  const hash = txHashOf(res);
  await rpc.waitForTransaction(tx, 180_000);
  return hash;
}

export interface AttestationRecord {
  signer: string;
  raw: unknown;
}

// Reads the contract's OutputAttested events via CSPR.cloud and returns the record
// for this output hash, or null if nothing was attested for it.
export async function findAttestation(outputHash: string): Promise<AttestationRecord | null> {
  requireContract();
  const url = `${CSPR_CLOUD}/contracts/${CONTRACT_HASH}/events?page=1&page_size=100`;
  const r = await fetch(url, { headers: { Authorization: CSPR_CLOUD_KEY } });
  if (!r.ok) throw new Error(`cspr.cloud events ${r.status}: ${await r.text()}`);
  const body = (await r.json()) as { data?: unknown[] };
  for (const ev of body.data ?? []) {
    if (JSON.stringify(ev).includes(outputHash)) {
      return { signer: extractSigner(ev) ?? "", raw: ev };
    }
  }
  return null;
}

export function isTrusted(signer: string): boolean {
  if (TRUSTED.length === 0) return true;
  return TRUSTED.includes(signer.toLowerCase());
}

function extractSigner(ev: unknown): string | undefined {
  const m = JSON.stringify(ev).match(/(account-hash-[0-9a-f]{64}|0[12][0-9a-f]{64})/i);
  return m?.[0];
}

function txHashOf(res: unknown): string {
  const h = (res as { transactionHash?: unknown }).transactionHash;
  return typeof h === "string" ? h : JSON.stringify(h);
}

function requireContract() {
  if (!NODE_URL) throw new Error("CASPER_CHAIN_RPC / CASPER_NODE_URL not set");
  if (!CONTRACT_HASH) throw new Error("REGISTRY_CONTRACT_HASH not set — deploy the contract first");
}
