import blakejs from "blakejs";
import * as sdk from "casper-js-sdk";

const { RpcClient, HttpHandler } = sdk;

const NODE_URL = process.env.CASPER_CHAIN_RPC ?? process.env.CASPER_NODE_URL ?? "";
const CONTRACT_HASH = (process.env.REGISTRY_CONTRACT_HASH ?? "").replace(/^(hash-|entity-contract-|contract-)/, "");
const VAULT_HASH = (process.env.VAULT_CONTRACT_HASH ?? "").replace(/^(hash-|entity-contract-|contract-)/, "");
const CSPR_CLOUD = process.env.CSPR_CLOUD_BASE ?? "https://api.testnet.cspr.cloud";
const CSPR_CLOUD_KEY = process.env.CSPR_CLOUD_API_KEY ?? "";
const EXPLORER = process.env.EXPLORER_BASE ?? "https://testnet.cspr.live";
const TRUSTED = (process.env.TRUSTED_SIGNERS ?? "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

// Field indices track the storage-field declaration order in AttestationRegistry
// (contract/src/lib.rs). Odra numbers module fields from 1 — keep in lockstep with
// Post-hardening layout (see agents/src/casper.ts): attestations(6), agreement(7), quorum_output(11).
const ATTESTATIONS_FIELD_INDEX = 6;
const AGREEMENT_FIELD_INDEX = 7;
const QUORUM_OUTPUT_FIELD_INDEX = 11;
const STATE_DICTIONARY = "state";

export const rpc = new RpcClient(new HttpHandler(NODE_URL));

export function contractConfigured(): boolean {
  return Boolean(NODE_URL && CONTRACT_HASH);
}

export function vaultConfigured(): boolean {
  return Boolean(VAULT_HASH);
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
  const b = await readStateBytes(QUORUM_OUTPUT_FIELD_INDEX, reqId);
  return b ? decodeString(b) : null;
}

// How many distinct trusted signers have attested this exact output for this request.
export async function readAgreement(reqId: string, outputHash: string): Promise<number> {
  const b = await readDictItem(stateItemKeyTuple(AGREEMENT_FIELD_INDEX, reqId, outputHash));
  return b ? u32le(b) : 0;
}

// Odra stores each field value as a CLValue List<U8> (the bytesrepr of the underlying
// type). Read it raw and return the decoded byte array, or null if the item is absent.
async function readStateBytes(fieldIndex: number, key: string): Promise<number[] | null> {
  return readDictItem(stateItemKey(fieldIndex, key));
}

async function readDictItem(itemKey: string): Promise<number[] | null> {
  const seedUref = await resolveStateUref();
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
// Casper 2.0 (Condor) doesn't resolve a contract named key by path, so read the whole
// stored Contract and pull the `state` dictionary seed uref from its named_keys.
async function resolveStateUref(): Promise<string> {
  if (cachedUref) return cachedUref;
  let lastErr: unknown;
  for (const key of contractKeyFormats(CONTRACT_HASH)) {
    try {
      const body = { jsonrpc: "2.0", id: 1, method: "query_global_state", params: { key, path: [] } };
      const r = await fetch(NODE_URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const j = (await r.json()) as { result?: { stored_value?: { Contract?: { named_keys?: Array<{ name: string; key: string }> } } } };
      const entry = (j.result?.stored_value?.Contract?.named_keys ?? []).find((nk) => nk.name === STATE_DICTIONARY);
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

// item key = hex(blake2b256( u32_be(field_index) ++ u32_le(len) ++ string_to_bytes(key) )),
// mirroring Odra's odra-core contract_env::current_key for a top-level Mapping field.
function stringBytes(s: string): Buffer {
  const utf8 = Buffer.from(s, "utf8");
  const len = Buffer.alloc(4);
  len.writeUInt32LE(utf8.length, 0);
  return Buffer.concat([len, utf8]);
}

export function stateItemKey(fieldIndex: number, key: string): string {
  const idx = Buffer.alloc(4);
  idx.writeUInt32BE(fieldIndex, 0);
  const preimage = Buffer.concat([idx, stringBytes(key)]);
  return Buffer.from(blakejs.blake2b(preimage, undefined, 32)).toString("hex");
}

// Tuple (String, String) Mapping key: field_index_be ++ string_bytes(a) ++ string_bytes(b).
export function stateItemKeyTuple(fieldIndex: number, a: string, b: string): string {
  const idx = Buffer.alloc(4);
  idx.writeUInt32BE(fieldIndex, 0);
  const preimage = Buffer.concat([idx, stringBytes(a), stringBytes(b)]);
  return Buffer.from(blakejs.blake2b(preimage, undefined, 32)).toString("hex");
}

// Registry already gates attest() to trusted callers; this optional allow-list narrows trust further (empty = accept any on-chain attestation).
export function isTrusted(signer: string): boolean {
  if (TRUSTED.length === 0) return true;
  return TRUSTED.includes(signer.toLowerCase());
}

export function explorerTxUrl(txHash: string): string {
  return `${EXPLORER}/deploy/${txHash}`;
}

export function explorerContractUrl(): string {
  return `${EXPLORER}/contract/${CONTRACT_HASH}`;
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

function isNotFound(e: unknown): boolean {
  const s = (e instanceof Error ? e.message : String(e)).toLowerCase();
  return s.includes("not found") || s.includes("valuenotfound") || s.includes("-32003") || s.includes("query failed");
}
