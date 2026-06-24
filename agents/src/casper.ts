import "dotenv/config";
import { readFileSync } from "node:fs";
import blakejs from "blakejs";
import sdk from "casper-js-sdk";

const {
  RpcClient,
  HttpHandler,
  PrivateKey,
  KeyAlgorithm,
  Key,
  Args,
  CLValue,
  ContractCallBuilder,
  PurseIdentifier,
} = sdk;
type PrivateKey = InstanceType<typeof sdk.PrivateKey>;

const NODE_URL = process.env.CASPER_CHAIN_RPC ?? process.env.CASPER_NODE_URL ?? "";
const NETWORK = process.env.CASPER_NETWORK_NAME ?? "casper-test";
const CONTRACT_HASH = (process.env.REGISTRY_CONTRACT_HASH ?? "").replace(/^(hash-|entity-contract-|contract-)/, "");
const CSPR_CLOUD = process.env.CSPR_CLOUD_BASE ?? "https://api.testnet.cspr.cloud";
const CSPR_CLOUD_KEY = process.env.CSPR_CLOUD_API_KEY ?? "";
const ATTEST_PAYMENT = Number(process.env.ATTEST_PAYMENT_MOTES ?? 3_000_000_000);
const ADMIN_PAYMENT = Number(process.env.ADMIN_PAYMENT_MOTES ?? 2_000_000_000);
const VAULT_HASH = (process.env.VAULT_CONTRACT_HASH ?? "").replace(/^(hash-|entity-contract-|contract-)/, "");
const VAULT_PAYMENT = Number(process.env.VAULT_PAYMENT_MOTES ?? 5_000_000_000);
const EXPLORER = process.env.EXPLORER_BASE ?? "https://testnet.cspr.live";
const TRUSTED = (process.env.TRUSTED_SIGNERS ?? "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

// Field indices track the storage-field declaration order in AttestationRegistry
// (contract/src/lib.rs). Odra numbers module fields from 1, so the struct maps to:
// owner(1), quorum_threshold(2), trusted(3), attestation_count(4), attestations(5),
// agreement(6), quorum_output(7), voted(8), slashes(9). Verified on testnet.
const ATTESTATIONS_FIELD_INDEX = 5;
const AGREEMENT_FIELD_INDEX = 6;
const QUORUM_OUTPUT_FIELD_INDEX = 7;
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

// Deterministic request id for a prompt. The same prompt always maps to the same
// request so independent producer agents vote on one shared request_id; a suffix
// keeps separate demo runs from colliding on-chain.
export function requestId(prompt: string, suffix = ""): string {
  const base = blakejs.blake2bHex(prompt, undefined, 8);
  return suffix ? `${base}-${suffix}` : base;
}

export interface AttestResult {
  txHash: string;
  cost: number;
  explorer: string;
}

export async function attest(
  key: PrivateKey,
  reqId: string,
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
        request_id: CLValue.newCLString(reqId),
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

export interface AdminResult {
  txHash: string;
  explorer: string;
}

// Owner-only: onboard a trusted signer-agent (its account hash) into the quorum set.
export async function setTrusted(key: PrivateKey, signerAccountHash: string, trusted: boolean): Promise<AdminResult> {
  return ownerCall(key, "set_trusted", {
    signer: CLValue.newCLKey(Key.newKey(signerAccountHash)),
    trusted: CLValue.newCLValueBool(trusted),
  });
}

// Owner-only: set the k-of-n quorum threshold.
export async function setQuorum(key: PrivateKey, threshold: number): Promise<AdminResult> {
  return ownerCall(key, "set_quorum", { threshold: CLValue.newCLUInt32(threshold) });
}

// Owner-only: slash a signer caught diverging/colluding — revokes trust and lowers standing.
export async function slashSigner(key: PrivateKey, signerAccountHash: string): Promise<AdminResult> {
  return ownerCall(key, "slash", { signer: CLValue.newCLKey(Key.newKey(signerAccountHash)) });
}

async function ownerCall(key: PrivateKey, entryPoint: string, args: Record<string, unknown>): Promise<AdminResult> {
  requireContract();
  const tx = new ContractCallBuilder()
    .byHash(CONTRACT_HASH)
    .entryPoint(entryPoint)
    .runtimeArgs(Args.fromMap(args as never))
    .from(key.publicKey)
    .chainName(NETWORK)
    .payment(ADMIN_PAYMENT)
    .build();
  tx.sign(key);
  const res = await rpc.putTransaction(tx);
  const txHash = hashHex(res.transactionHash);
  const info = await rpc.waitForTransaction(tx, 180_000);
  const error = info.executionInfo?.executionResult?.errorMessage;
  if (error) throw new Error(`${entryPoint} reverted on-chain: ${error} (tx ${txHash})`);
  return { txHash, explorer: explorerTxUrl(txHash) };
}

export interface VaultReleaseResult {
  txHash: string;
  authorized: boolean;
  reason?: string;
  explorer: string;
}

// Calls PayoutVault.release on-chain. The vault cross-calls the registry's quorum_of()
// inside the Casper VM: an output that reached k-of-n quorum authorizes the payout; a
// poisoned/under-quorum output reverts (NoQuorum). Either way this is a real testnet tx.
export async function releaseVault(
  key: PrivateKey,
  reqId: string,
  outputHash: string,
  beneficiaryAccountHash: string
): Promise<VaultReleaseResult> {
  if (!NODE_URL) throw new Error("CASPER_CHAIN_RPC / CASPER_NODE_URL not set");
  if (!VAULT_HASH) throw new Error("VAULT_CONTRACT_HASH not set — deploy the vault first");
  const tx = new ContractCallBuilder()
    .byHash(VAULT_HASH)
    .entryPoint("release")
    .runtimeArgs(
      Args.fromMap({
        request_id: CLValue.newCLString(reqId),
        output_hash: CLValue.newCLString(outputHash),
        beneficiary: CLValue.newCLKey(Key.newKey(beneficiaryAccountHash)),
      })
    )
    .from(key.publicKey)
    .chainName(NETWORK)
    .payment(VAULT_PAYMENT)
    .build();
  tx.sign(key);

  const res = await rpc.putTransaction(tx);
  const txHash = hashHex(res.transactionHash);
  const info = await rpc.waitForTransaction(tx, 180_000);
  const error = info.executionInfo?.executionResult?.errorMessage;
  return { txHash, authorized: !error, reason: error ?? undefined, explorer: explorerTxUrl(txHash) };
}

export interface AttestationRecord {
  signer: string;
  source: "chain" | "cspr.cloud";
  raw: unknown;
}

// Looks up whether `outputHash` has a base attestation on the registry. Primary path
// reads the contract's state dictionary straight from the node (no indexer, no API key);
// if that can't resolve and a CSPR.cloud key is configured, it falls back to events.
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

// The quorum-attested output hash for a request, or null if no output has reached the
// threshold yet. Reads the quorum_output dictionary directly from the node.
export async function readQuorum(reqId: string): Promise<string | null> {
  requireContract();
  const b = await readStateBytes(QUORUM_OUTPUT_FIELD_INDEX, reqId);
  return b ? decodeString(b) : null;
}

// How many distinct trusted signers have attested this exact output for this request.
export async function readAgreement(reqId: string, outputHash: string): Promise<number> {
  requireContract();
  const b = await readStateBytes(AGREEMENT_FIELD_INDEX, `${reqId}#${outputHash}`);
  return b ? u32le(b) : 0;
}

// Odra stores each field value as a CLValue List<U8> (the bytesrepr of the underlying type).
// Read it raw and return the decoded byte array, or null if the item does not exist.
async function readStateBytes(fieldIndex: number, key: string): Promise<number[] | null> {
  const seedUref = await resolveStateUref();
  const itemKey = stateItemKey(fieldIndex, key);
  const srh = await stateRootHash();
  const body = {
    jsonrpc: "2.0",
    id: 1,
    method: "state_get_dictionary_item",
    params: { state_root_hash: srh, dictionary_identifier: { URef: { seed_uref: seedUref, dictionary_item_key: itemKey } } },
  };
  const r = await fetch(NODE_URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = (await r.json()) as { result?: { stored_value?: { CLValue?: { parsed?: unknown } } } };
  const parsed = j.result?.stored_value?.CLValue?.parsed;
  return Array.isArray(parsed) ? (parsed as number[]) : null;
}

async function stateRootHash(): Promise<string> {
  const body = { jsonrpc: "2.0", id: 1, method: "chain_get_state_root_hash", params: {} };
  const r = await fetch(NODE_URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return ((await r.json()) as { result?: { state_root_hash?: string } }).result?.state_root_hash ?? "";
}

function u32le(b: number[], off = 0): number {
  return (b[off] | (b[off + 1] << 8) | (b[off + 2] << 16) | (b[off + 3] << 24)) >>> 0;
}

// Odra String = u32_le(len) ++ utf8 bytes.
function decodeString(b: number[]): string {
  return Buffer.from(b.slice(4, 4 + u32le(b))).toString("utf8");
}

// Odra Address = Key = 1-byte tag (00 = account, 01 = hash) ++ 32-byte hash.
function decodeSigner(b: number[]): string {
  const hex = Buffer.from(b.slice(1, 33)).toString("hex");
  return b[0] === 0 ? `account-hash-${hex}` : `hash-${hex}`;
}

async function readAttestationOnChain(outputHash: string): Promise<AttestationRecord | null> {
  const b = await readStateBytes(ATTESTATIONS_FIELD_INDEX, outputHash);
  if (!b) return null;
  return { signer: decodeSigner(b), source: "chain", raw: b };
}

let cachedUref: string | undefined;
// Casper 2.0 (Condor) doesn't resolve a contract named key by path, so we read the
// whole stored Contract and pull the `state` dictionary seed uref from its named_keys.
async function resolveStateUref(): Promise<string> {
  if (cachedUref) return cachedUref;
  let lastErr: unknown;
  for (const key of contractKeyFormats(CONTRACT_HASH)) {
    try {
      const body = { jsonrpc: "2.0", id: 1, method: "query_global_state", params: { key, path: [] } };
      const r = await fetch(NODE_URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const j = (await r.json()) as { result?: { stored_value?: { Contract?: { named_keys?: Array<{ name: string; key: string }> } } } };
      const namedKeys = j.result?.stored_value?.Contract?.named_keys ?? [];
      const entry = namedKeys.find((nk) => nk.name === STATE_DICTIONARY);
      if (entry?.key?.startsWith("uref-")) {
        cachedUref = entry.key;
        return entry.key;
      }
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(
    `could not resolve the '${STATE_DICTIONARY}' dictionary uref for contract ${CONTRACT_HASH} — check REGISTRY_CONTRACT_HASH` +
      (lastErr ? ` (last error: ${(lastErr as Error).message})` : "")
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

// On-chain trust is enforced by the registry: attest() reverts for non-trusted callers,
// so any attestation that exists was written by a registry-trusted signer. This optional
// allow-list lets a consumer narrow trust further; empty = accept any on-chain attestation.
export function isTrusted(signer: string): boolean {
  if (TRUSTED.length === 0) return true;
  return TRUSTED.includes(signer.toLowerCase());
}

export function explorerTxUrl(txHash: string): string {
  return `${EXPLORER}/deploy/${txHash}`;
}

export const rpcUrl = NODE_URL;
export const registryHash = CONTRACT_HASH;
export const vaultHash = VAULT_HASH;

export interface NodeStatus {
  apiVersion: string;
  chainName: string;
}

// Cheapest read that proves the RPC is reachable and tells us which network it serves.
export async function pingNode(): Promise<NodeStatus> {
  if (!NODE_URL) throw new Error("CASPER_CHAIN_RPC / CASPER_NODE_URL not set");
  const status = await rpc.getStatus();
  return { apiVersion: status.apiVersion, chainName: status.chainSpecName };
}

// Latest available balance in motes for a key's main purse, read-only.
export async function balanceMotes(pemPath: string): Promise<bigint> {
  const key = loadKey(pemPath);
  const res = await rpc.queryLatestBalance(PurseIdentifier.fromPublicKey(key.publicKey));
  return BigInt(res.balance.toString());
}

export function accountHashOf(pemPath: string): string {
  return loadKey(pemPath).publicKey.accountHash().toPrefixedString();
}

// Resolves a deployed contract's state seed uref straight from the node — proves the
// REGISTRY_CONTRACT_HASH points at a real, queryable contract. Read-only.
export async function contractReachable(): Promise<boolean> {
  await resolveStateUref();
  return true;
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
