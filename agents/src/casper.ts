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
const ADMIN_PAYMENT = Number(process.env.ADMIN_PAYMENT_MOTES ?? 2_000_000_000);
const VAULT_HASH = (process.env.VAULT_CONTRACT_HASH ?? "").replace(/^(hash-|entity-contract-|contract-)/, "");
const VAULT_PAYMENT = Number(process.env.VAULT_PAYMENT_MOTES ?? 5_000_000_000);
const EXPLORER = process.env.EXPLORER_BASE ?? "https://testnet.cspr.live";
const TRUSTED = (process.env.TRUSTED_SIGNERS ?? "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

// Field indices track the storage-field declaration order in AttestationRegistry
// (contract/src/lib.rs). Odra keys each module field by its position, so these MUST
// stay in lockstep with the struct: owner(0), quorum_threshold(1), trusted(2),
// attestation_count(3), attestations(4), agreement(5), quorum_output(6), voted(7).
const ATTESTATIONS_FIELD_INDEX = 4;
const AGREEMENT_FIELD_INDEX = 5;
const QUORUM_OUTPUT_FIELD_INDEX = 6;
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
  const stored = await readStateItem(QUORUM_OUTPUT_FIELD_INDEX, reqId);
  if (stored === null) return null;
  return parseHashValue(stored);
}

// How many distinct trusted signers have attested this exact output for this request.
export async function readAgreement(reqId: string, outputHash: string): Promise<number> {
  requireContract();
  const stored = await readStateItem(AGREEMENT_FIELD_INDEX, `${reqId}#${outputHash}`);
  if (stored === null) return 0;
  return parseNumberValue(stored);
}

async function readStateItem(fieldIndex: number, key: string): Promise<unknown | null> {
  const seedUref = await resolveStateUref();
  const itemKey = stateItemKey(fieldIndex, key);
  const identifier = new ParamDictionaryIdentifier(
    undefined,
    undefined,
    new ParamDictionaryIdentifierURef(itemKey, seedUref)
  );
  try {
    return await rpc.getDictionaryItemByIdentifier(null, identifier);
  } catch (e) {
    if (isNotFound(e)) return null;
    throw e;
  }
}

async function readAttestationOnChain(outputHash: string): Promise<AttestationRecord | null> {
  const stored = await readStateItem(ATTESTATIONS_FIELD_INDEX, outputHash);
  if (stored === null) return null;
  return { signer: extractSigner(stored), source: "chain", raw: (stored as { rawJSON?: unknown }).rawJSON ?? stored };
}

let cachedUref: string | undefined;
async function resolveStateUref(): Promise<string> {
  if (cachedUref) return cachedUref;
  let lastErr: unknown;
  for (const key of contractKeyFormats(CONTRACT_HASH)) {
    try {
      const res = await rpc.queryLatestGlobalState(key, [STATE_DICTIONARY]);
      const uref = urefOf(res);
      if (uref) {
        cachedUref = uref;
        return uref;
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

// The registry stores a CLString output hash; CLValue JSON carries it under "parsed".
function parseHashValue(stored: unknown): string | null {
  const s = JSON.stringify(stored);
  const parsed = s.match(/"parsed"\s*:\s*"([0-9a-fA-F]{64})"/);
  if (parsed) return parsed[1].toLowerCase();
  const any = s.match(/[0-9a-f]{64}/i);
  return any ? any[0].toLowerCase() : null;
}

function parseNumberValue(stored: unknown): number {
  const s = JSON.stringify(stored);
  const parsed = s.match(/"parsed"\s*:\s*(\d+)/);
  return parsed ? Number(parsed[1]) : 0;
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
