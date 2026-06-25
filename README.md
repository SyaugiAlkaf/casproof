# Casproof

[![ci](https://github.com/SyaugiAlkaf/casproof/actions/workflows/ci.yml/badge.svg)](https://github.com/SyaugiAlkaf/casproof/actions/workflows/ci.yml)

**An unskippable on-chain action firewall for AI agents — verify-before-act, enforced in the Casper VM.**

An AI agent produces a result — a price feed, a risk score, an RWA valuation. Before any value-bearing action fires, a consuming contract must prove that result passed attestation. Not suggested by off-chain logic. Not checked and then acted on in two separate calls. Proved and acted on in **one atomic Casper VM execution**, so there is no gap an attacker or a misconfigured agent can slip through. This firewall guarantee applies when a consuming contract cross-calls `require_quorum` inside the Casper WASM VM; off-chain agents that read quorum state and act in a separate call are not covered by this guarantee.

That is the gap Casproof closes. `registry.require_quorum(request_id, output_hash)` is a composable guard: any contract cross-calls it, and the verify decision plus the caller's own action run atomically. If the output did not reach the attestation threshold, the VM reverts before a single mote moves. No off-chain agent can override it — the enforcement is in the WASM runtime, not in client configuration.

![Casproof dashboard — verify an AI agent output on-chain, and watch a poisoned feed get blocked](docs/dashboard.png)

## Live on Casper testnet

All transactions are on `casper-test` and verifiable on the explorer. Reproduce with the Quickstart commands below.

**Deployed contracts:**

| Contract | Hash |
|---|---|
| AttestationRegistry | [`b0898108...cac7d41`](https://testnet.cspr.live/contract/b089810867192d3da7d4ab61f0ac70acfd101685cedb6f551f4ca9734cac7d41) |
| PayoutVault | [`c7d68a16...63392b23`](https://testnet.cspr.live/contract/c7d68a16dcfd78aa9c0b6a7ed12b837b9a1dfd72bd4668e6361c2ec263392b23) |

**Request panel:** request id `823d1427b2bdfbae-mqsw4r8x` · k=2 of 2 signers (claude-opus-4-8, claude-sonnet-4-6)

| Step | Transaction |
|---|---|
| Registry deploy (AttestationRegistry install) | [8e352175...843e907](https://testnet.cspr.live/deploy/8e352175570a775606a09e7b551083552654e699de3784d0a1b926a98843e907) |
| set_quorum(2) | [35d59097...416b30ba](https://testnet.cspr.live/deploy/35d590977a678b2feb1d52b0b993838a193f71aecee3ba2bfab94a82416b30ba) |
| set_trusted (onboard claude-sonnet-4-6 signer) | [c62ecb0e...6b752a02](https://testnet.cspr.live/deploy/c62ecb0e0b1284f8c1624b3fd8f8408047d343697040b90cc76507306b752a02) |
| Vault deploy (PayoutVault install) | [6a361e78...d63c7725](https://testnet.cspr.live/deploy/6a361e78ec7c66e4a9f6db9434538982e34e602808d4d4433bdb2e0dd63c7725) |
| Genuine attestation (claude-opus-4-8 signer) | [74fac27d...9c8b4b94](https://testnet.cspr.live/deploy/74fac27db23f5df223928dc60ab22852fabe5c7f945f41c46556743c9c8b4b94) |
| PayoutVault.release SUCCESS (quorum met, PAY) | [b1e88bb8...e349ef54](https://testnet.cspr.live/deploy/b1e88bb8c06fa3fe9d7d7bae73a5b5ccc534ba4a9f918e6dd80311d6e349ef54) |
| PayoutVault.release REVERT (poisoned, NoQuorum / User error 4) | [34e7b7a9...0a07e318](https://testnet.cspr.live/deploy/34e7b7a9afeaba9a4cf60e52ac28c98a99dc34063735e3e4617135080a07e318) |

## The problem

Every major verify-before-act system today has a structural gap: the verification call and the value-bearing action are two separate steps. EigenAI, Chainlink, and zkML approaches verify output integrity off-chain or in a separate on-chain call, then the consuming contract acts on the result. Between those two steps, a misconfigured agent, a relay exploit, or a simple off-chain bug can substitute a different output. The consuming contract never knows.

Casper's own attestation toolkit lets agents attest outputs. But there is no enforcement primitive — no way for a contract to say "I will not act unless this output is attested, and that check happens right here, in this call, with no gap."

Casproof builds that primitive: `require_quorum` is a cross-contract guard that runs inside the Casper WASM VM in the same atomic execution as the consuming contract's action. The gap disappears.

The second problem is the audit trail. Regulated financial workflows — AI-assisted RWA valuations, compliance sign-offs, risk scoring — need to prove that the AI output their system acted on was the genuine, unmodified result from sources they trusted, at a specific point in time. That record needs to be tamper-evident and independent of the operator. Casproof writes it on-chain with every attestation.

## How it works

![Casproof architecture — attested on-chain, consumer verifies in-VM before payout, exposed over MCP and metered with x402](docs/architecture.png)

### The action firewall (`require_quorum`)

`registry.require_quorum(request_id, output_hash) → Address` is the core primitive. It checks that `output_hash` is the quorum-attested result for `request_id`. If it is, it returns the lead signer's address. If it is not — wrong hash, no quorum yet, tampered payload — it reverts with `NoQuorum`.

The key property: any contract can cross-call `require_quorum` as the first step of an action entrypoint. In Casper's WASM VM, that cross-call and the rest of the entrypoint run in one atomic execution. If the guard reverts, the entire transaction reverts. There is no window between "check passed" and "action fired" for anything to change.

`PayoutVault` is the reference consumer. The payer escrows CSPR with `deposit(request_id, beneficiary)` — binding the beneficiary on-chain — then `release(request_id, output_hash)` calls `require_quorum` and, only on a verified output, transfers the escrowed CSPR to the bound beneficiary and emits `PayoutAuthorized` with the lead signer's reputation. If the output is poisoned or under-quorum, `release` reverts on-chain before a single mote moves — a failed deploy on the explorer, auditable and permanent. Escrow on a request that never reaches quorum is recoverable by the payer with `refund(request_id)`.

### Quorum as one pluggable attestation policy

Quorum is not the product. It is the first attestation policy behind the gate.

K distinct trusted signers each call `attest(request_id, output_hash, model_id, prompt_hash)` on the registry. The registry counts distinct-signer agreement per `(request_id, output_hash)` pair. When k separate trusted signers have attested the byte-identical hash for the same request, the request becomes quorum-attested and `QuorumReached` fires. The winning hash is stored in `quorum_output[request_id]` — the value `require_quorum` reads.

The check is deterministic: pure hash equality, not an opinion poll. A swapped or tampered output produces a different hash, increments a separate counter, and cannot contribute to the agreeing set.

Future proof sources — TEE remote-attestation receipts, zkML proofs, optimistic re-execution — plug into the same guard. The gate stays; the evidence changes.

### Honest trust model

Today the trusted signer set is owner-curated. The **owner** is a trusted setup role: it calls `set_quorum`, `set_trusted`, and `slash`, and is the single-point-of-failure until removed. The intended lifecycle is: deploy → configure quorum and the trusted panel → call `renounce_ownership()` to freeze the configuration and eliminate the owner role; `transfer_ownership(new_owner)` is also available for a handoff before renouncing. That is the right tradeoff for a buildathon deployment, but it deserves an honest accounting of what it means.

A curated signer could in principle attest any hash, including one they did not genuinely compute. Several mitigations are live now:

- **Slashing.** `registry.slash(signer)` (owner-only) revokes trust and reduces the signer's reputation score (`attestation_count - slashes`). Reputation falls when you lie, so there is a cost — skin in the game for the curated set. Slashing is sticky: a slashed signer no longer counts toward quorum even if re-trusted, until explicitly re-onboarded.
- **Quorum size.** Compromising k signers independently is harder than compromising one. The live demo runs k=2 across two separate model keys; the value is configurable via `set_quorum`. In the current demo both keys are operated by the same entity — true independence requires separately-operated and separately-staked signers, which is the economic-security roadmap item.
- **Escrow refund.** `refund(request_id)` lets the depositor reclaim escrowed CSPR for a request that never reaches quorum, so stuck funds are recoverable.

The roadmap mitigation is binding attestations to proof-of-computation receipts — TEE remote-attestation or zkML — so a signer cannot attest a hash without evidence the computation actually ran. That turns the curated set into a verified-computation set. Until then, the system is "trust this panel plus slashing" not "trust nobody."

We do not claim the current system is computation-proof. We claim the enforcement gate is real, the audit trail is on-chain, and the copy-resistance path is clear.

### Adversarially tested

The core gate was audited adversarially and hardened. The verify-before-act guarantee is backed by regression tests that *reproduce* each exploit and prove it is now blocked — not just happy-path tests. `cd contract && cargo odra test` runs 26 tests (19 functional + 7 adversarial):

- **Quorum forgery (C1).** A single trusted signer cannot forge a k-of-n quorum: the agreement tally is keyed by a structured `(request_id, output_hash)` tuple with per-signer dedup, and `attest` rejects the `#` separator — so ambiguous framings can no longer collide into one counter. *(`c1_collision_framings_cannot_forge_quorum`, `c1_attest_rejects_separator_in_inputs`)*
- **Revocable quorum (C2).** `require_quorum` re-counts only signers who are *still trusted* at call time, so slashing the colluders who reached a quorum revokes it for as long as they stay untrusted — a poisoned output cannot pass the gate while its backers are slashed. The gate reflects live trust in both directions by design. *(`c2_slashing_revokes_a_reached_quorum`)*
- **Authorized, one-shot payout (H1).** `PayoutVault.release` is callable only by the authorized payer and at most once per request, so a public `request_id`/`output_hash` cannot be replayed or redirected by a stranger. *(`h1_unauthorized_caller_cannot_release`, `h1_release_is_one_shot`)*
- **Real value through the gate (M2).** The vault escrows CSPR per request (beneficiary bound on-chain at deposit) and transfers it only after `require_quorum` passes — a poisoned or under-quorum release reverts *before a single mote moves*. *(`m2_release_moves_escrowed_funds_only_on_quorum`)*
- **Stable threshold (M1).** The quorum threshold is snapshotted at a request's first attestation, so lowering `set_quorum` cannot retroactively seal an under-quorum in-flight request. *(`m1_lowering_threshold_cannot_seal_an_inflight_request`)*

The lead signer returned by the gate is bound to a still-trusted signer who attested *that* request, so reputation is attributed correctly.

### Reputation

`reputation(signer)` returns `attestation_count - slashes` for any signer. It increases when a signer attests honestly and decreases when the owner slashes them. It cannot overflow (saturating subtraction). It is emitted in every `PayoutAuthorized` event, giving downstream consumers a portable on-chain quality signal about the signers behind the output they are acting on.

### Metered verification (x402)

The `/verify` endpoint is paywalled with [x402](https://x402.org): an unpaid request gets `402 Payment Required` with Casper payment requirements (`casper:casper-test`); the client attaches an `X-PAYMENT` header; the request is settled through the hosted Casper facilitator (`x402-facilitator.cspr.cloud`); only then does the endpoint perform the real on-chain read. An oracle operator earns per verified read while agents pay only for what they consume.

> **Known limitation:** the server-side paywall and facilitator settlement are real. The reference client (`payVerify.ts`) constructs the payment payload but does not yet sign it with the Casper x402 scheme (`@casper-ecosystem/casper-eip-712`), so the end-to-end handshake runs in `X402_MODE=sim` out of the box. Fully-live end-to-end x402 — with the Casper payment signer and a CSPR.cloud key wired in — is a roadmap item.

### Agent-discoverable (MCP)

Casproof ships an [MCP](https://modelcontextprotocol.io) server so any AI agent — Claude Desktop, an autonomous agent, anything that speaks the Model Context Protocol — can discover and call it directly. Three tools:

- `casproof_compute_hash` — fingerprint an output (no chain access)
- `casproof_verify_output` — a convenience read of the on-chain quorum verdict, returning a `PROCEED` / `BLOCK` advisory; enforcement requires composing `require_quorum` in-VM and this advisory read does not reflect live slash state at call time
- `casproof_attest` — publish an attestation on-chain (real testnet transaction)

This is exactly the pattern Casper's AI toolkit is built around — *agents discover capabilities via MCP, pay via x402, settle on-chain* — and it makes Casproof both a **consumer** of agentic infrastructure (it attests its own AI outputs) and a **provider** of it (other agents call it to verify-before-act).

## Components

| Path | What it is |
|---|---|
| `contract/` | Two [Odra](https://odra.dev) (Rust → WASM) contracts: `AttestationRegistry` (quorum-native, trusted-signer-gated `attest`, composable `require_quorum` guard, slashable `reputation`) and `PayoutVault` — a consumer that composes `require_quorum` so verify-and-act are one atomic VM call. 26 OdraVM tests (19 functional + 7 adversarial). |
| `agents/` | TypeScript multi-model producer panel, autonomous consumer agent, on-chain read library, x402 verify server, MCP server, slash script, and keygen/deploy/resolve/setup scripts (`casper-js-sdk` v5, Anthropic API). |
| `ui/` | Next.js dashboard (CSPR.click wallet connect) — verify an output, show the attestation badge and explorer link, and the live poison→block contrast screen. |

**Casproof in the Casper stack:** Odra (contract) · casper-js-sdk v5 (agents) · x402 facilitator (metered reads) · MCP (agent discovery) · CSPR.click (dashboard wallet) — four of Casper's flagship AI-toolkit components, composed into one verifiable-action primitive.

## Quick start

### Prerequisites

- Rust + the [cargo-odra](https://github.com/odradev/cargo-odra) CLI (`cargo install cargo-odra`). The contract pins `nightly-2026-01-01` via `contract/rust-toolchain.toml`; `wasm-opt`/`wasm-strip` (binaryen + wabt) are used to shrink the wasm.
- Node 20+.
- Funded Casper **testnet** keys ([faucet](https://testnet.cspr.live/tools/faucet)). The faucet funds a key once — use a fresh keypair per key role. The quorum panel needs one funded key per model agent.

### Contract

```bash
cd contract
make test                # OdraVM unit tests (26 tests: 19 functional + 7 adversarial)
make build               # build + wasm-opt -Oz → wasm/AttestationRegistry.wasm (~192 KB)
```

### Agents — full command order

```bash
cd agents
npm install
cp ../.env.example ../.env

# 1. Generate keys for the quorum panel (one key per model agent + owner key)
npm run keygen:quorum
#   → prints public keys; fund each once at https://testnet.cspr.live/tools/faucet

# 2. Deploy the registry contract
npm run deploy
#   → prints deploy hash; wait for finality (~2 min)

# 3. Print and save contract hashes
npm run resolve
#   → paste REGISTRY_CONTRACT_HASH + REGISTRY_PACKAGE_HASH into .env

# 4. Deploy the PayoutVault (needs REGISTRY_PACKAGE_HASH in .env)
npm run deploy:vault
#   → prints deploy hash

# 5. Print and save vault hash
npm run resolve:vault
#   → paste VAULT_CONTRACT_HASH into .env

# 6. Configure on-chain: set_quorum(k) + trust all panel signers
npm run setup

# 7. Run the full demo (quorum → PAY, poisoned → REVERT)
npm run demo
```

### Individual agents

```bash
npm run producer         # one model agent: produce an RWA valuation + attest on-chain
npm test                 # unit tests (+ deploy-gated integration test)
```

### Slash a signer

```bash
npm run slash -- <account-hash>   # owner-only: revoke trust + lower reputation
```

### Metered verification (x402)

```bash
npm run x402:server              # GET /verify?hash=<outputHash>, paywalled with x402
npm run x402:verify <outputHash> # client: handles 402 → pay → retry, prints the verified result
```

### MCP server

```bash
npm run mcp              # stdio MCP server exposing compute_hash / verify / attest
```

Plug it into any MCP client — see `agents/mcp.example.json` for a Claude Desktop config. Once connected, an assistant can verify an RWA output in natural language ("is this valuation attested on Casper?").

### Dashboard

```bash
cd ui
npm install --legacy-peer-deps   # CSPR.click pins React 18 peers
cp .env.example .env.local       # CASPER_CHAIN_RPC + REGISTRY_CONTRACT_HASH
npm run dev                      # http://localhost:3000
```

### Run with Docker

Bring up the x402 verify server (and optionally the dashboard) on any machine with one command — no local Node toolchain needed.

```bash
cp .env.example .env             # then set REGISTRY_CONTRACT_HASH + CASPER_CHAIN_RPC after deploy
docker compose up                # verify server on http://localhost:4021/verify
docker compose --profile ui up   # also build + serve the dashboard on http://localhost:3000
```

Config is read from the root `.env` (mounted via `env_file`, never baked into an image). Testnet keys under `agents/keys/` stay on the host and are excluded from every image by `.dockerignore`. The `verify` service has a healthcheck; `X402_MODE` defaults to `sim`, so it runs out of the box before you wire up the hosted x402 facilitator. See [docs/docker.md](docs/docker.md) for ports, profiles, and configuration notes.

## Why Casper

- **The WASM VM is the enforcement surface.** Cross-contract calls in Casper's WASM runtime are atomic within a single deploy. That is what makes `require_quorum` an unskippable gate rather than a strongly-suggested check. On EVM chains the same pattern is possible but incurs full CALL overhead; on off-chain systems it is advisory. On Casper it is a revert or it does not happen.
- **Real-world assets and compliance.** The reference flow — AI-attested RWA valuation gating a DeFi payout — maps directly to the regulated, value-bearing machine-to-machine use case Casper targets. The on-chain audit trail (who attested, under which model and prompt hash, at which block, with what reputation) is what a compliance function needs for AI-assisted decisions in regulated finance.
- **Agent-native.** Producer and consumer are autonomous agents; they discover Casproof over MCP, pay for verification over x402, and settle on-chain — the exact agent loop Casper's AI toolkit is designed for.
- **Honest on-chain.** Every attestation is a real testnet transaction; verification reads real contract state; the quorum and verify-gate are enforced by the contract, not by client configuration. Nothing is mocked in the trust path.

## Design notes

- Output hashing is canonical (keys sorted, deterministic JSON, BLAKE2b-256) so the same payload always hashes identically regardless of serialization. Every model agent in the panel runs the same canonical hash before attesting.
- `attest()` reverts for untrusted callers and for duplicate votes (one-vote-per-signer-per-request enforced in storage). An on-chain attestation is itself proof a trusted signer submitted it.
- `require_quorum` is separate from `quorum_of` and `verify` to make the composability pattern explicit: any contract that wants the firewall calls `require_quorum`; callers that only want to read the state call the view functions.
- `PayoutVault.release()` calls `require_quorum` (not `quorum_of` + `verify` in sequence). That is one cross-contract call, not two; and the guard's revert path means the vault's action never starts unless the check passes.
- All chain calls live in one module (`agents/src/casper.ts`); the storage-key derivation that lets the consumer read the registry without an indexer is unit-tested against a fixed vector.

## Launch plan

See [docs/launch-plan.md](docs/launch-plan.md) for the full roadmap.

The short version:
1. **Action firewall, now.** The `require_quorum` gate and slashable reputation are deployed and tested. Any Casper contract can compose the guard today.
2. **Pluggable proof sources.** Bind attestations to TEE remote-attestation receipts and zkML proofs so the curated signer set transitions to a verified-computation set. The gate API does not change.
3. **Staking and economic security.** Replace owner-curated slashing with bonded stake so signers have capital at risk, not just reputation.
4. **Mainnet + audit.** Harden and audit both contracts; deploy to Casper mainnet; publish the Oracle SDK (`attest`/`require_quorum` in under 10 lines).
5. **AI compliance infrastructure.** Map the trusted-signer set to ERC-3643-style permissioned issuers; attestation of reasoning traces for regulated financial decisions requiring explainability.

## Long-term impact

As AI agents increasingly transact on each other's outputs — feeds, scores, signals — regulated finance needs an answer to "can I prove the AI output my system acted on was the genuine, unmodified result from sources I trust, and that the action was gated on that proof?" Casproof makes that a one-call, on-chain primitive. By exposing it over MCP and metering it with x402, it becomes infrastructure rather than a single application. The `require_quorum` guard is the slot that any future proof-of-computation scheme — TEE, zk, optimistic re-execution — plugs into: the proof source is theirs; the unskippable on-chain settlement gate is Casproof's.

## License

Apache-2.0
