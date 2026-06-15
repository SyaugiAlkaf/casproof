import "dotenv/config";
import { readFileSync } from "node:fs";
import blakejs from "blakejs";
import sdk from "casper-js-sdk";

const {
  RpcClient,
  HttpHandler,
  PrivateKey,
  KeyAlgorithm,
  Args,
  CLValue,
  ContractCallBuilder,
  ParamDictionaryIdentifier,
  ParamDictionaryIdentifierURef,
} = sdk;
type PrivateKey = InstanceType<typeof sdk.PrivateKey>;

const NODE_URL = process.env.CASPER_CHAIN_RPC ?? process.env.CASPER_NODE_URL ?? "";
const NETWORK = process.env.CASPER_NETWORK_NAME ?? "casper-test";
const CONTRACT_HASH = (process.env.REGISTRY_CONTRACT_HASH ?? "").replace(/^(hash-|entity-contract-|contract-)/, "");
const CSPR_CLOUD = process.env.CSPR_CLOUD_BASE ?? "https://api.testnet.cspr.cloud";
const CSPR_CLOUD_KEY = process.env.CSPR_CLOUD_API_KEY ?? "";
const ATTEST_PAYMENT = Number(process.env.ATTEST_PAYMENT_MOTES ?? 3_000_000_000);
const EXPLORER = process.env.EXPLORER_BASE ?? "https://testnet.cspr.live";
const TRUSTED = (process.env.TRUSTED_SIGNERS ?? "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

// Field index of the `attestations` Mapping inside AttestationRegistry.
// Declaration order: owner(0), attestations(1), trusted(2). Odra keys each module
// field by its position, so this must track the struct in contract/src/lib.rs.
const ATTESTATIONS_FIELD_INDEX = 1;
const STATE_DICTIONARY = "state";

export const rpc = new RpcClient(new HttpHandler(NODE_URL));
export const network = NETWORK;

export function loadKey(pemPath: string): PrivateKey {
  const algo =
    (process.env.KEY_ALGORITHM ?? "").toLowerCase() === "secp256k1"
      ? KeyAlgorithm.SECP256K1
      : KeyAlgorithm.ED25519;
  return PrivateKey.fromPem(readFileSync(pemPath, "utf8"), algo);
}

export interface AttestResult {
  txHash: string;
  cost: number;
  explorer: string;
}

export async function attest(
  key: PrivateKey,
  outputHash: string,
  modelId: string,
  promptHashHex: string
): Promise<AttestResult> {
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
  const txHash = hashHex(res.transactionHash);
  const info = await rpc.waitForTransaction(tx, 180_000);
  const result = info.executionInfo?.executionResult;
  if (result?.errorMessage) {
    throw new Error(`attest reverted on-chain: ${result.errorMessage} (tx ${txHash})`);
  }
  return { txHash, cost: Number(result?.consumed ?? 0), explorer: explorerTxUrl(txHash) };
}

export interface AttestationRecord {
  signer: string;
  source: "chain" | "cspr.cloud";
  raw: unknown;
}

// Looks up whether `outputHash` is attested on the registry. Primary path reads the
// contract's state dictionary straight from the node (no indexer, no API key); if that
// can't resolve and a CSPR.cloud key is configured, it falls back to the events index.
export async function findAttestation(outputHash: string): Promise<AttestationRecord | null> {
  requireContract();
  try {
    return await readAttestationOnChain(outputHash);
  } catch (e) {
    if (isNotFound(e)) return null;
    if (CSPR_CLOUD_KEY) return findAttestationViaEvents(outputHash);
    throw e;
  }
}

async function readAttestationOnChain(outputHash: string): Promise<AttestationRecord | null> {
  const seedUref = await resolveStateUref();
  const itemKey = stateItemKey(ATTESTATIONS_FIELD_INDEX, outputHash);
  const identifier = new ParamDictionaryIdentifier(
    undefined,
    undefined,
    new ParamDictionaryIdentifierURef(itemKey, seedUref)
  );
  let stored;
  try {
    stored = await rpc.getDictionaryItemByIdentifier(null, identifier);
  } catch (e) {
    if (isNotFound(e)) return null;
    throw e;
  }
  return { signer: extractSigner(stored), source: "chain", raw: stored.rawJSON ?? stored };
}

let cachedUref: string | undefined;
async function resolveStateUref(): Promise<string> {
  if (cachedUref) return cachedUref;
  for (const key of contractKeyFormats(CONTRACT_HASH)) {
    try {
      const res = await rpc.queryLatestGlobalState(key, [STATE_DICTIONARY]);
      const uref = urefOf(res);
      if (uref) {
        cachedUref = uref;
        return uref;
      }
    } catch (e) {
      if (!isNotFound(e)) throw e;
    }
  }
  throw new Error(
    `could not resolve the '${STATE_DICTIONARY}' dictionary uref for contract ${CONTRACT_HASH} — check REGISTRY_CONTRACT_HASH`
  );
}

// item key = hex(blake2b256( u32_be(field_index) ++ string_to_bytes(key) )),
// mirroring Odra's odra-core contract_env::current_key for a top-level Mapping field.
export function stateItemKey(fieldIndex: number, key: string): string {
  const idx = Buffer.alloc(4);
  idx.writeUInt32BE(fieldIndex, 0);
  const utf8 = Buffer.from(key, "utf8");
  const len = Buffer.alloc(4);
  len.writeUInt32LE(utf8.length, 0);
  const preimage = Buffer.concat([idx, len, utf8]);
  return Buffer.from(blakejs.blake2b(preimage, undefined, 32)).toString("hex");
}

export function isTrusted(signer: string): boolean {
  if (TRUSTED.length === 0) return true;
  return TRUSTED.includes(signer.toLowerCase());
}

export function explorerTxUrl(txHash: string): string {
  return `${EXPLORER}/deploy/${txHash}`;
}

async function findAttestationViaEvents(outputHash: string): Promise<AttestationRecord | null> {
  const url = `${CSPR_CLOUD}/contracts/${CONTRACT_HASH}/events?page=1&page_size=100`;
  const r = await fetch(url, { headers: { authorization: CSPR_CLOUD_KEY } });
  if (!r.ok) throw new Error(`cspr.cloud events ${r.status}: ${await r.text()}`);
  const body = (await r.json()) as { data?: Array<{ name?: string; data?: Record<string, unknown> }> };
  for (const ev of body.data ?? []) {
    const fields = ev.data ?? {};
    if (ev.name === "OutputAttested" && fields.output_hash === outputHash) {
      return { signer: String(fields.signer ?? ""), source: "cspr.cloud", raw: ev };
    }
  }
  return null;
}

function contractKeyFormats(hash: string): string[] {
  return [`hash-${hash}`, `entity-contract-${hash}`, hash];
}

function urefOf(res: unknown): string | undefined {
  const m = JSON.stringify(res).match(/uref-[0-9a-f]{64}-[0-9a-f]{3}/i);
  return m?.[0];
}

function extractSigner(stored: unknown): string {
  const m = JSON.stringify(stored).match(/(account-hash-[0-9a-f]{64}|0[12][0-9a-f]{64})/i);
  return m?.[0] ?? "";
}

function hashHex(h: { transactionV1?: { toHex(): string }; deploy?: { toHex(): string } }): string {
  return h.transactionV1?.toHex() ?? h.deploy?.toHex() ?? "";
}

function isNotFound(e: unknown): boolean {
  const s = (e instanceof Error ? e.message : String(e)).toLowerCase();
  return s.includes("not found") || s.includes("valuenotfound") || s.includes("-32003") || s.includes("query failed");
}

function requireContract() {
  if (!NODE_URL) throw new Error("CASPER_CHAIN_RPC / CASPER_NODE_URL not set");
  if (!CONTRACT_HASH) throw new Error("REGISTRY_CONTRACT_HASH not set — deploy the contract first");
}
