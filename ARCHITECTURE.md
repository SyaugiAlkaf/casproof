# Casproof — Architecture

This document is written for a technical reviewer (Halborn-style audit, integration developer, or hackathon judge assessing technical depth). It covers both contracts, every entrypoint, storage layout, event schema, cross-contract execution, the off-chain agent layer, and the trust assumptions.

---

## What Casproof does (and does not do)

Casproof solves the **enforcement problem**, not the inference problem.

The question "is this AI output correct?" sits above Casproof's layer. The question Casproof answers is: "is this the quorum-attested result for this request, and can my contract act on it atomically without any gap between the check and the action?"

The novel contribution is the `require_quorum` guard: a composable cross-contract entrypoint that any consuming contract calls as the first step of its action. In Casper's WASM runtime, that cross-call and the rest of the consuming entrypoint execute in one atomic VM call. If the guard reverts, the entire transaction reverts. There is no window between "verification passed" and "action fired."

Existing approaches (EigenAI, Chainlink, zkML pipelines) verify off-chain or in a prior on-chain call, then hand a result to the consuming contract. That two-step structure leaves a gap. Casproof's atomic enforcement gate closes it.

Verifiable inference (zkML, TEE remote-attestation, opML) is not Casproof's claim. Those systems prove *what computation ran*. Casproof is the gate that *enforces settlement on the result of that computation*. The two compose: a zkML proof can be the evidence behind a Casproof attestation; the `require_quorum` guard remains the unskippable settlement layer regardless of which proof source is used.

---

## Contracts

Both contracts are implemented in Rust with [Odra](https://odra.dev) (compiles to WASM). They are deployed as separate named keys on Casper and interact via cross-contract calls using the `External` Odra pattern.

### AttestationRegistry

**Source:** `contract/src/lib.rs` (struct `AttestationRegistry`)

The core registry. It maintains a panel of trusted signers, accumulates attestation votes, resolves quorum, and exposes the `require_quorum` guard for composable enforcement.

#### Entrypoints

| Entrypoint | Mutating | Caller | Description |
|---|---|---|---|
| `init()` | yes | deployer (once) | Sets owner to caller, adds caller as first trusted signer, sets threshold to 1. |
| `attest(request_id, output_hash, model_id, prompt_hash)` | yes | trusted signer | Records one vote. Reverts `NotTrusted` if caller is not in the trusted set. Reverts `AlreadyVoted` if this signer has already voted on `request_id`. Increments `agreement[request_id#output_hash]` and `attestation_count[caller]`. Emits `OutputAttested`. When the agreement count for this pair reaches `quorum_threshold` and no quorum has been recorded yet for this request, records `quorum_output[request_id] = output_hash` and emits `QuorumReached`. |
| `require_quorum(request_id, output_hash) → Address` | no | any contract | The composable verify-before-act guard. Returns the lead signer's address if `output_hash` is the quorum-attested result for `request_id`. Reverts `NoQuorum` otherwise. Consuming contracts cross-call this as the first step of a value-bearing action so the verify decision and the action run atomically in the Casper VM. |
| `verify(output_hash) → Option<Attestation>` | no | anyone | Returns the base attestation record (the first signer's record for this hash), or `None`. |
| `quorum_of(request_id) → Option<String>` | no | anyone | Returns the quorum-winning output hash for the request, or `None` if quorum has not been reached. |
| `agreement_count(request_id, output_hash) → u32` | no | anyone | Returns the number of distinct trusted signers that have attested this exact hash for this request. |
| `threshold() → u32` | no | anyone | Returns the current quorum threshold k. |
| `is_trusted(addr) → bool` | no | anyone | Returns whether the address is in the trusted set. |
| `reputation(addr) → u64` | no | anyone | Returns `attestation_count - slashes` for this signer (saturating subtraction). |
| `set_trusted(addr, bool)` | yes | owner | Adds or removes an address from the trusted signer set. Reverts `NotOwner` for non-owner callers. |
| `set_quorum(threshold)` | yes | owner | Sets the quorum threshold. Reverts `NotOwner` for non-owner callers. Reverts `InvalidQuorum` if threshold is 0. |
| `slash(signer)` | yes | owner | Revokes trust (`trusted[signer] = false`), increments `slashes[signer]`, and emits `SignerSlashed`. Reduces `reputation(signer)` by 1. Slashed signers cannot attest until re-trusted. |

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
| `slashes` | 8 | `Mapping<Address, u64>` | serialized Address |

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

**`SignerSlashed`** — emitted when the owner calls `slash(signer)`:

| Field | Type | Notes |
|---|---|---|
| `signer` | Address | The signer whose trust was revoked and reputation reduced |

#### Error codes

| Code | Value | Condition |
|---|---|---|
| `NotOwner` | 1 | `set_trusted`, `set_quorum`, or `slash` called by non-owner |
| `NotTrusted` | 2 | `attest` called by an address not in the trusted set |
| `NotAttested` | 3 | `require_quorum` resolved a quorum winner but no attestation record exists (should not occur in normal operation) |
| `NoQuorum` | 4 | `require_quorum` called and `output_hash` is not the quorum result for `request_id` |
| `AlreadyVoted` | 5 | The same signer attempts a second `attest` on the same `request_id` |
| `InvalidQuorum` | 6 | `set_quorum(0)` called |

---

### PayoutVault

**Source:** `contract/src/lib.rs` (struct `PayoutVault`)

A DeFi consumer contract. It demonstrates the action firewall pattern: `release` composes `registry.require_quorum` so the verify decision and the payout authorization happen in one atomic VM call.

#### Entrypoints

| Entrypoint | Mutating | Caller | Description |
|---|---|---|---|
| `init(registry: Address)` | yes | deployer (once) | Stores the registry contract address. |
| `release(request_id, output_hash, beneficiary) → u64` | yes | consumer agent | Cross-calls `registry.require_quorum(request_id, output_hash)`. If it reverts (`NoQuorum`), the entire transaction reverts — no further code runs. If it succeeds, cross-calls `registry.reputation(signer)` to get the lead signer's score, emits `PayoutAuthorized`, and returns the reputation score. |

#### Cross-contract execution

`PayoutVault.release` calls `require_quorum` (one cross-contract call). If the guard passes, it calls `registry.reputation(signer)` (a second cross-contract call). Both calls and the `PayoutAuthorized` emit happen in the same Casper WASM VM execution. A `NoQuorum` revert from `require_quorum` rolls back the entire transaction at the VM level — there is no off-chain bypass path.

This is a deliberate simplification from the earlier two-step pattern (`quorum_of` then `verify`). Calling `require_quorum` directly expresses intent — the caller wants enforcement, not just information — and reduces the number of cross-contract calls when a revert is the expected failure mode.

#### Events

**`PayoutAuthorized`** — emitted on a successful `release`:

| Field | Type | Notes |
|---|---|---|
| `request_id` | String | |
| `output_hash` | String | The quorum-winning hash |
| `beneficiary` | Address | Recipient passed by the caller |
| `signer` | Address | Lead signer (first attester of this hash) |
| `reputation` | u64 | Lead signer's net reputation (`attestation_count - slashes`) at time of release |

#### Storage layout

| Field | Index | Type |
|---|---|---|
| `registry` | 0 | `External<RegistryContractRef>` (Address) |

---

## The `require_quorum` guard — composability pattern

`require_quorum` is designed to be the first line of any consuming contract's action entrypoint:

```rust
pub fn my_action(&mut self, request_id: String, output_hash: String, ...) {
    let lead_signer = self.registry.require_quorum(request_id, output_hash);
    // ... rest of the action; only reached if guard passed
}
```

Because Casper's WASM runtime executes the entire deploy atomically, if `require_quorum` reverts, `my_action` reverts entirely. The consumer's state is not modified. The guard cannot be bypassed by reordering calls, by relaying results through an intermediary, or by patching off-chain logic.

Any contract that wants to add the firewall to an existing action entrypoint adds one cross-contract call at the top. The registry address can be stored as an `External` field and configured at deploy time.

---

## Quorum mechanics — walkthrough

Given threshold k=3 and a panel of 3 trusted signers (A, B, C):

1. Signer A calls `attest(req, H, "model-a", ph)`. Registry: `attestations[H]` written (first write wins), `agreement[req#H]` → 1, `attestation_count[A]` → 1. Emits `OutputAttested`.
2. Signer B calls `attest(req, H, "model-b", ph)`. `agreement[req#H]` → 2. Emits `OutputAttested`.
3. Signer C calls `attest(req, H, "model-c", ph)`. `agreement[req#H]` → 3 = threshold. `quorum_output[req] = H`. Emits `QuorumReached`.

If signer C was tampered and produced hash `H'`:
- `agreement[req#H]` stays at 2 — below threshold.
- `agreement[req#H']` = 1 — also below threshold.
- `quorum_output[req]` remains unset.
- `PayoutVault.release(req, H, ...)` → `require_quorum` reverts `NoQuorum` → entire transaction reverts.

---

## Pluggable proof sources

Quorum — k independent signers attesting the same hash — is the current attestation policy. It is one policy, not the only possible policy.

`require_quorum` reads `quorum_output[request_id]`. Anything that writes to `quorum_output` in a trust-minimized way is a valid proof source. Planned sources:

| Source | Mechanism | Status |
|---|---|---|
| Multi-signer quorum | k distinct trusted signers attest byte-identical hash | Live |
| TEE remote-attestation | Signer submits TEE quote alongside the hash; registry verifies quote before accepting attestation | Roadmap |
| zkML proof | Off-chain ML inference with on-chain verifiable proof; proof verified in contract before attest accepted | Roadmap |
| Optimistic re-execution | Any node can re-run and submit a challenge; quorum resolves after challenge window | Roadmap |

The gate API (`require_quorum`, `PayoutVault.release`) does not change as proof sources are added. Consuming contracts built on the current interface remain compatible.

---

## Trust assumptions and threat model

### What is trusted today

- **The owner key.** The owner controls `set_trusted`, `set_quorum`, and `slash`. A compromised owner key can add malicious signers, lower the threshold to 1, and attest any hash. Mitigations on the roadmap: multi-sig or timelock on owner operations.
- **The curated signer set.** Signers are trusted by the owner, not by proof of computation. A colluding group of k signers can attest any hash as quorum-attested. The current mitigation is slashing (costs reputation) and quorum size (requires k colluders independently).

### The copy attack

A curated signer could observe a legitimate attestation's `output_hash` and attest the same hash for a different `request_id` they control, or front-run a request by watching mempool and submitting an attestation before computing the output.

The on-chain contract does not prevent this today. What prevents it in practice:
- Slashing gives the owner a tool to penalize signers caught doing it; reputation falls.
- Quorum requires k colluders acting consistently.

What eliminates it on the roadmap:
- Binding attestations to TEE remote-attestation receipts or zkML proofs — the signer cannot produce a valid attestation without evidence the computation ran on a specific input.

We do not claim the current system prevents a colluding signer set from attesting arbitrary hashes. We claim:
1. The enforcement gate is real and unskippable.
2. Slashing gives the curated set skin in the game now.
3. The path to copy-resistance is clear and the API does not change when it lands.

### What the contract does enforce (unconditionally)

- A non-trusted signer cannot attest (`NotTrusted` revert).
- A trusted signer cannot vote twice on the same request (`AlreadyVoted` revert).
- A quorum result cannot be overwritten once set (`is_none()` guard in `attest`).
- `PayoutVault.release` cannot succeed without a matching quorum result — enforced by the VM, not by client code.
- Slashed signers cannot attest until explicitly re-trusted.

---

## Output hashing

**Canonical JSON:** keys are sorted lexicographically, values are `JSON.stringify` for scalars.

**Digest:** BLAKE2b-256 over the UTF-8 bytes of the canonical JSON string → 32-byte hex string.

**Prompt hash:** the same digest applied to the prompt string, stored separately in the attestation record. A verifier can confirm what was asked without the registry storing prompt text.

The canonical hash logic is implemented in `agents/src/attest.ts` and must byte-match any off-chain re-computation. The storage-key derivation is in `agents/src/casper.ts` (`stateItemKey`) and is unit-tested against a fixed vector.

---

## Off-chain agent roles

### Owner / setup agent

Runs `npm run setup` once after deploy. Calls `set_quorum(k)` and `set_trusted(addr, true)` for each panel key. Owner key is the registry deployer (agent 0 key, `PRODUCER_KEY_PATH`).

Runs `npm run slash -- <account-hash>` to slash a misbehaving signer.

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
3. A poisoned hash passed to `release` causes an on-chain revert visible on the explorer.

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
- **One-vote-per-request:** the `voted` mapping (field 7, keyed by `(request_id, signer)`) prevents any single key from submitting multiple votes on the same request and stuffing the agreement counter. This also prevents a signer from voting on a different output hash for the same request.
- **Quorum is write-once:** once `quorum_output[request_id]` is set, the `is_none()` guard in `attest()` prevents it from being overwritten, even if more signers later agree on a different hash.
- **VM-enforced verify-gate:** `require_quorum` reverts atomically. There is no off-chain bypass path and no gap between the check and the consuming action.
- **Slashable reputation:** `reputation = attestation_count - slashes` (saturating). Slashing revokes trust and reduces standing. A signer that lies cannot accumulate reputation by attesting more — the score falls, not rises.
- **No prompt storage:** only `prompt_hash` is stored on-chain, not the prompt text.
