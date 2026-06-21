# Casproof — Architecture

This document is written for a technical reviewer (Halborn-style audit, integration developer, or hackathon judge assessing technical depth). It covers both contracts, every entrypoint, storage layout, event schema, cross-contract execution, and the off-chain agent layer.

---

## Integrity vs. accuracy

Casproof solves the **integrity problem**, not the accuracy problem.

Before asking "is this AI output correct?" you must first be able to answer: "is this the genuine, untampered output of model X on prompt Y, produced by at least k independent trusted signers?" Accuracy oracles, financial validators, and reputation-weighting systems sit on top of the integrity layer — they can assume a hash has not been tampered with because the registry and quorum mechanics enforce it.

This distinction is load-bearing for the architecture. Casproof does not score outputs or rank models. It records the existence and provenance of a particular hash under a particular quorum, with a one-way ratchet: once a hash reaches quorum, that fact is on-chain and permanent.

---

## Contracts

Both contracts are implemented in Rust with [Odra](https://odra.dev) (compiles to WASM). They are deployed as separate named keys on Casper and interact via cross-contract calls using the `External` Odra pattern.

### AttestationRegistry

**Source:** `contract/src/lib.rs` (struct `AttestationRegistry`)

The core registry. It maintains a panel of trusted signers, accumulates attestation votes, and resolves quorum.

#### Entrypoints

| Entrypoint | Mutating | Caller | Description |
|---|---|---|---|
| `init()` | yes | deployer (once) | Sets owner to caller, adds caller as first trusted signer, sets threshold to 1. |
| `attest(request_id, output_hash, model_id, prompt_hash)` | yes | trusted signer | Records one vote. Reverts `NotTrusted` if caller is not in the trusted set. Reverts `AlreadyVoted` if this signer has already voted on `request_id`. Increments `agreement[request_id#output_hash]` and `attestation_count[caller]`. Emits `OutputAttested`. When the agreement count for this pair reaches `quorum_threshold` and no quorum has been recorded yet for this request, records `quorum_output[request_id] = output_hash` and emits `QuorumReached`. |
| `verify(output_hash) → Option<Attestation>` | no | anyone | Returns the base attestation record (the first signer's record for this hash), or `None`. |
| `quorum_of(request_id) → Option<String>` | no | anyone | Returns the quorum-winning output hash for the request, or `None` if quorum has not been reached. |
| `agreement_count(request_id, output_hash) → u32` | no | anyone | Returns the number of distinct trusted signers that have attested this exact hash for this request. |
| `threshold() → u32` | no | anyone | Returns the current quorum threshold k. |
| `is_trusted(addr) → bool` | no | anyone | Returns whether the address is in the trusted set. |
| `reputation(addr) → u64` | no | anyone | Returns the total number of attestations this signer has published, across all requests. |
| `set_trusted(addr, bool)` | yes | owner | Adds or removes an address from the trusted signer set. Reverts `NotOwner` for non-owner callers. |
| `set_quorum(threshold)` | yes | owner | Sets the quorum threshold. Reverts `NotOwner` for non-owner callers. Reverts `InvalidQuorum` if threshold is 0. |

#### Storage layout

Odra stores each field in a Casper contract dictionary named `"state"`. Fields are indexed by their declaration order in the struct (zero-based). Mappings use a composite key derived as:

```
item_key = hex( blake2b256( u32_be(field_index) ++ u32_le(utf8_byte_length(key)) ++ utf8(key) ) )
```

| Field | Index | Type | Odra storage key pattern |
|---|---|---|---|
| `owner` | 0 | `Var<Address>` | fixed key (empty string) |
| `quorum_threshold` | 1 | `Var<u32>` | fixed key |
| `trusted` | 2 | `Mapping<Address, bool>` | serialized Address |
| `attestation_count` | 3 | `Mapping<Address, u64>` | serialized Address |
| `attestations` | 4 | `Mapping<String, Attestation>` | output_hash (hex string) |
| `agreement` | 5 | `Mapping<String, u32>` | `{request_id}#{output_hash}` |
| `quorum_output` | 6 | `Mapping<String, String>` | request_id |
| `voted` | 7 | `Mapping<(String, Address), bool>` | `(request_id, signer)` serialized |

The off-chain consumer re-derives `item_key` for field 4 (`attestations`) and field 6 (`quorum_output`) to read contract state over RPC without an indexer. This derivation is implemented and unit-tested in `agents/src/casper.ts` (`stateItemKey`).

#### Events

**`OutputAttested`** — emitted on every accepted `attest()` call:

| Field | Type | Notes |
|---|---|---|
| `request_id` | String | Identifies the prompt/request (deterministic, derived off-chain) |
| `output_hash` | String | BLAKE2b-256 hex of canonical JSON output |
| `model_id` | String | Identifier for the model that produced the output |
| `signer` | Address | On-chain address of the attesting agent key |
| `timestamp` | u64 | `env.get_block_time()` at the time of the call |

**`QuorumReached`** — emitted once, when `agreement[request_id#output_hash]` crosses `quorum_threshold` for the first time:

| Field | Type | Notes |
|---|---|---|
| `request_id` | String | |
| `output_hash` | String | The winning hash |
| `threshold` | u32 | The k that was required |
| `agreed` | u32 | The actual count of agreeing signers (>= threshold) |

#### Error codes

| Code | Value | Condition |
|---|---|---|
| `NotOwner` | 1 | `set_trusted` or `set_quorum` called by non-owner |
| `NotTrusted` | 2 | `attest` called by an address not in the trusted set |
| `NotAttested` | 3 | `verify` returned `None` inside PayoutVault (internal guard) |
| `NoQuorum` | 4 | `release` called without a quorum result for the request |
| `AlreadyVoted` | 5 | The same signer attempts a second `attest` on the same `request_id` |
| `InvalidQuorum` | 6 | `set_quorum(0)` called |

---

### PayoutVault

**Source:** `contract/src/lib.rs` (struct `PayoutVault`)

A DeFi consumer contract. It enforces the verify-before-act pattern inside the Casper VM: `release` cannot succeed without a valid quorum result from the registry.

#### Entrypoints

| Entrypoint | Mutating | Caller | Description |
|---|---|---|---|
| `init(registry: Address)` | yes | deployer (once) | Stores the registry contract address. |
| `release(request_id, output_hash, beneficiary) → u64` | yes | consumer agent | Cross-calls `registry.quorum_of(request_id)`. If the result does not match `output_hash`, reverts `NoQuorum`. If it matches, cross-calls `registry.verify(output_hash)` to get the lead signer, then `registry.reputation(signer)` to get their attestation count, emits `PayoutAuthorized`, and returns the reputation score. |

#### Cross-contract execution

`PayoutVault.release` performs three cross-contract calls in one VM execution (all within the Casper WASM runtime):

1. `registry.quorum_of(request_id)` — reads `quorum_output` field (index 6)
2. `registry.verify(output_hash)` — reads `attestations` field (index 4)
3. `registry.reputation(signer)` — reads `attestation_count` field (index 3)

None of these calls can be skipped or spoofed by the caller. The entire decision tree is inside the VM. A poisoned or unattested feed produces a `NoQuorum` revert that is recorded on-chain as a failed deploy.

#### Events

**`PayoutAuthorized`** — emitted on a successful `release`:

| Field | Type | Notes |
|---|---|---|
| `request_id` | String | |
| `output_hash` | String | The quorum-winning hash |
| `beneficiary` | Address | Recipient passed by the caller |
| `signer` | Address | Lead signer (first attester of this hash) |
| `reputation` | u64 | Lead signer's on-chain attestation count at time of release |

#### Storage layout

| Field | Index | Type |
|---|---|---|
| `registry` | 0 | `External<RegistryContractRef>` (Address) |

---

## Quorum mechanics — walkthrough

Given threshold k=3 and a panel of 3 model agents (A, B, C), each trusted:

1. Agent A computes valuation, canonical-hashes the payload → `H`. Calls `attest(req, H, "model-a", ph)`. Registry records `attestations[H]` (first write wins), increments `agreement[req#H]` to 1, increments `attestation_count[A]`. Emits `OutputAttested`.
2. Agent B independently computes the same prompt → `H` (deterministic). Calls `attest(req, H, "model-b", ph)`. `agreement[req#H]` → 2. Emits `OutputAttested`.
3. Agent C calls `attest(req, H, "model-c", ph)`. `agreement[req#H]` → 3 = threshold. Registry records `quorum_output[req] = H`. Emits `QuorumReached`.

If agent C had been tampered and produced a different hash `H'`:
- `agreement[req#H]` stays at 2, below threshold.
- `agreement[req#H']` = 1, also below threshold.
- `quorum_output[req]` remains unset.
- `PayoutVault.release(req, H, ...)` → `quorum_of(req)` = `None` → `NoQuorum` revert.

---

## Output hashing

**Canonical JSON:** keys are sorted lexicographically, values are JSON.stringify for scalars, arrays as `[a,b]`.

**Digest:** BLAKE2b-256 over the UTF-8 bytes of the canonical JSON string → 32-byte hex string.

**Prompt hash:** the same digest applied to the prompt string (not the payload), stored separately in the attestation record. A verifier can confirm what was asked without the registry storing prompt text.

The canonical hash logic is implemented in `agents/src/attest.ts` and must byte-match any off-chain re-computation. The storage-key derivation is in `agents/src/casper.ts` (`stateItemKey`) and is unit-tested against a fixed vector.

---

## Off-chain agent roles

### Owner / setup agent

Runs `npm run setup` once after deploy. Calls `set_quorum(k)` and `set_trusted(addr, true)` for each panel key. Owner key is the registry deployer (agent 0 key, `PRODUCER_KEY_PATH`).

### Multi-model producer panel

`npm run demo` / `npm run producer` spawns one producer per panel entry. Each reads `QUORUM_MODELS` from the environment (format: `modelId:keyPath,modelId:keyPath,...`; defaults to 3 agents). Each independently:
1. Calls the Anthropic API with the RWA valuation prompt.
2. Canonical-hashes the response payload.
3. Calls `attest(request_id, output_hash, model_id, prompt_hash)` on-chain with its own key.

`request_id` is derived deterministically from the prompt using `requestId(prompt, suffix?)` in `agents/src/casper.ts` (BLAKE2b-256 of the prompt string, optionally suffixed). All agents in the panel use the same prompt → same `request_id`.

### Autonomous consumer

`npm run consumer` / `npm run demo` (consumer phase):
1. Reads `quorum_of(request_id)` from the registry (via RPC or CSPR.cloud event fallback).
2. If quorum has been reached, calls `PayoutVault.release(request_id, quorum_hash, beneficiary)`.
3. A tampered hash passed to `release` causes an on-chain revert visible on the explorer.

### x402 verify server

`npm run x402:server` — paywalled HTTP endpoint. The client (`npm run x402:verify`) handles the 402 → payment header → retry cycle. In `X402_MODE=sim` the payment step is simulated locally (default). In `X402_MODE=live` it settles via `x402-facilitator.cspr.cloud`.

### MCP server

`npm run mcp` — stdio MCP server exposing three tools:

| Tool | Description |
|---|---|
| `casproof_compute_hash` | Canonical-hash an output payload locally (no chain access) |
| `casproof_verify_output` | Read the registry on-chain for a given hash; return `PROCEED` or `BLOCK` |
| `casproof_attest` | Publish an attestation (real testnet transaction) |

Any MCP-compatible client (Claude Desktop, autonomous agent) can call these after connecting to the server via `mcp.example.json`.

---

## Build direction mapping (Casper Agentic Buildathon criterion 6)

| Casper AI toolkit component | Where used in Casproof |
|---|---|
| Odra (Rust → WASM contracts) | `AttestationRegistry` + `PayoutVault` |
| casper-js-sdk v5 | All on-chain calls in `agents/src/casper.ts` |
| x402 facilitator (`x402-facilitator.cspr.cloud`) | `agents/src/server.ts`, `agents/src/payVerify.ts` |
| MCP | `agents/src/mcp.ts` — three agent-callable tools |
| CSPR.click | `ui/` — wallet connect for the dashboard |

---

## Environment variables

See `.env.example` for the full reference. Key variables:

| Variable | Purpose |
|---|---|
| `REGISTRY_CONTRACT_HASH` | Bare hex contract hash (no prefix); set after `npm run resolve` |
| `REGISTRY_PACKAGE_HASH` | Package hash; needed to deploy the vault |
| `VAULT_CONTRACT_HASH` | Set after `npm run resolve:vault` |
| `QUORUM_THRESHOLD` | k for `set_quorum`; defaults to 3 |
| `QUORUM_MODELS` | `modelId:keyPath,...` panel; defaults to 3 agents using the three generated keys |
| `PRODUCER_KEY_PATH` | Owner key (agent 0); also the deployer |
| `X402_MODE` | `sim` (default) or `live` |
| `ANTHROPIC_API_KEY` | Used by producer agents to call the model |

---

## Security properties

- **Trusted-signer gate:** `attest()` reverts for any caller not in the `trusted` mapping. Adding/removing signers requires the owner key.
- **One-vote-per-request:** the `voted` mapping (field 7, keyed by `(request_id, signer)`) prevents any single key from submitting multiple votes and stuffing the agreement counter.
- **Quorum is write-once:** once `quorum_output[request_id]` is set, the `is_none()` guard in `attest()` prevents it from being overwritten, even if more signers later agree on a different hash.
- **VM-enforced verify-gate:** `PayoutVault.release()` cannot succeed without a matching `quorum_of` result. There is no off-chain bypass path.
- **No prompt storage:** only `prompt_hash` is stored on-chain, not the prompt text.
