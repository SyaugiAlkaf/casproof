# Casproof

[![ci](https://github.com/SyaugiAlkaf/casproof/actions/workflows/ci.yml/badge.svg)](https://github.com/SyaugiAlkaf/casproof/actions/workflows/ci.yml)

**An unskippable on-chain action firewall for AI agents — verify-before-act, enforced in the Casper VM.**

An AI agent produces a result — a price feed, a risk score, an RWA valuation. Before any value-bearing action fires, a consuming contract must prove that result passed attestation. Not suggested by off-chain logic. Not checked and then acted on in two separate calls. Proved and acted on in **one atomic Casper VM execution**, so there is no gap an attacker or a misconfigured agent can slip through.

That is the gap Casproof closes. `registry.require_quorum(request_id, output_hash)` is a composable guard: any contract cross-calls it, and the verify decision plus the caller's own action run atomically. If the output did not reach the attestation threshold, the VM reverts before a single mote moves. No off-chain agent can override it — the enforcement is in the WASM runtime, not in client configuration.

![Casproof dashboard — verify an AI agent output on-chain, and watch a poisoned feed get blocked](docs/dashboard.png)

## Live on Casper testnet

All transactions are on `casper-test` and verifiable on the explorer. Reproduce with the Quickstart commands below.

**Deployed contracts:**

| Contract | Hash |
|---|---|
| AttestationRegistry | [`1ef8d1ad...f91dc2`](https://testnet.cspr.live/contract/1ef8d1adf9078fbd392990685ba461785b03b77fb3f45ba5dd00bdbef5f91dc2) |
| PayoutVault | [`1d0efbdd...42fe319`](https://testnet.cspr.live/contract/1d0efbdddea74baf8b180f33c5697b9efa346270e539334cf46978a4f42fe319) |

**Request panel:** request id `823d1427b2bdfbae-mqrk0lcn` · k=2 of 2 signers (claude-opus-4-8, claude-sonnet-4-6)

| Step | Transaction |
|---|---|
| Registry deploy (AttestationRegistry install) | [ac63abe6...815fd6](https://testnet.cspr.live/deploy/ac63abe6b41030f7279ddeca2893d5461ce3ce69dd8ab26547287d77c9815fd6) |
| set_quorum(2) | [26b828ff...7a74c60](https://testnet.cspr.live/deploy/26b828ff3c5fb70581700f463719c6294bc0a9e728e1c40e2a8f107ff7a74c60) |
| set_trusted (onboard claude-sonnet-4-6 signer) | [779d8944...9fee01](https://testnet.cspr.live/deploy/779d8944a6e0ca885a32665c8959a7e64a993ddf1bf4d532cac9344d079fee01) |
| Vault deploy (PayoutVault install) | [2f2aebad...4293e8](https://testnet.cspr.live/deploy/2f2aebadc10301da75023c05c9f54628247dfe39be294042e66372f28b4293e8) |
| Genuine attestation (claude-opus-4-8 signer) | [96764d94...3d054bd](https://testnet.cspr.live/deploy/96764d94c84aa5ffc190de103c683bacf9a319638a282568079d610c33d054bd) |
| PayoutVault.release SUCCESS (quorum met, PAY) | [4e419629...475bb730](https://testnet.cspr.live/deploy/4e419629ee121636bb93b7b2f2bf86662190c88b68cc4a3c32a19014475bb730) |
| PayoutVault.release REVERT (poisoned, NoQuorum / User error 4) | [08215a1e...8246aa81](https://testnet.cspr.live/deploy/08215a1e12fec76e53f59a10404bea518cf8d5c6f359512964f6054d8246aa81) |

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

`PayoutVault.release(request_id, output_hash, beneficiary)` is the reference consumer. It calls `require_quorum`, then emits `PayoutAuthorized` with the lead signer's address and reputation score. If the output is poisoned or under-quorum, `release` reverts on-chain — a failed deploy on the explorer, auditable and permanent.

### Quorum as one pluggable attestation policy

Quorum is not the product. It is the first attestation policy behind the gate.

K independent trusted signers each call `attest(request_id, output_hash, model_id, prompt_hash)` on the registry. The registry counts distinct-signer agreement per `(request_id, output_hash)` pair. When k distinct trusted signers have attested the byte-identical hash for the same request, the request becomes quorum-attested and `QuorumReached` fires. The winning hash is stored in `quorum_output[request_id]` — the value `require_quorum` reads.

The check is deterministic: pure hash equality, not an opinion poll. A swapped or tampered output produces a different hash, increments a separate counter, and cannot contribute to the agreeing set.

Future proof sources — TEE remote-attestation receipts, zkML proofs, optimistic re-execution — plug into the same guard. The gate stays; the evidence changes.

### Honest trust model

Today the trusted signer set is owner-curated. That is the right tradeoff for a buildathon deployment, but it deserves an honest accounting of what it means.

A curated signer could in principle attest any hash, including one they did not genuinely compute. Two mitigations are live now:

- **Slashing.** `registry.slash(signer)` (owner-only) revokes trust and reduces the signer's reputation score (`attestation_count - slashes`). Reputation falls when you lie, so there is a cost — skin in the game for the curated set.
- **Quorum size.** Compromising k signers independently is harder than compromising one. The live demo runs k=2 across two independent model keys; the value is configurable via `set_quorum`.

The roadmap mitigation is binding attestations to proof-of-computation receipts — TEE remote-attestation or zkML — so a signer cannot attest a hash without evidence the computation actually ran. That turns the curated set into a verified-computation set. Until then, the system is "trust this panel plus slashing" not "trust nobody."

We do not claim the current system is computation-proof. We claim the enforcement gate is real, the audit trail is on-chain, and the copy-resistance path is clear.

### Reputation

`reputation(signer)` returns `attestation_count - slashes` for any signer. It increases when a signer attests honestly and decreases when the owner slashes them. It cannot overflow (saturating subtraction). It is emitted in every `PayoutAuthorized` event, giving downstream consumers a portable on-chain quality signal about the signers behind the output they are acting on.

### Metered verification (x402)

The `/verify` endpoint is paywalled with [x402](https://x402.org): an unpaid request gets `402 Payment Required` with Casper payment requirements (`casper:casper-test`); the client attaches an `X-PAYMENT` header; the request is settled through the hosted Casper facilitator (`x402-facilitator.cspr.cloud`); only then does the endpoint perform the real on-chain read. An oracle operator earns per verified read while agents pay only for what they consume.

The server-side paywall and facilitator settlement are real. The reference client (`payVerify.ts`) constructs the payment payload but does not yet sign it with the Casper x402 scheme (`@casper-ecosystem/casper-eip-712`), so the end-to-end handshake runs in `X402_MODE=sim` out of the box; pointing it at the live facilitator additionally requires the Casper payment signer and a CSPR.cloud key.

### Agent-discoverable (MCP)

Casproof ships an [MCP](https://modelcontextprotocol.io) server so any AI agent — Claude Desktop, an autonomous agent, anything that speaks the Model Context Protocol — can discover and call it directly. Three tools:

- `casproof_compute_hash` — fingerprint an output (no chain access)
- `casproof_verify_output` — check an output on-chain and get back a `PROCEED` / `BLOCK` decision
- `casproof_attest` — publish an attestation on-chain (real testnet transaction)

This is exactly the pattern Casper's AI toolkit is built around — *agents discover capabilities via MCP, pay via x402, settle on-chain* — and it makes Casproof both a **consumer** of agentic infrastructure (it attests its own AI outputs) and a **provider** of it (other agents call it to verify-before-act).

## Components

| Path | What it is |
|---|---|
| `contract/` | Two [Odra](https://odra.dev) (Rust → WASM) contracts: `AttestationRegistry` (quorum-native, trusted-signer-gated `attest`, composable `require_quorum` guard, slashable `reputation`) and `PayoutVault` — a consumer that composes `require_quorum` so verify-and-act are one atomic VM call. 19 OdraVM unit tests. |
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
make test                # OdraVM unit tests (19 tests)
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
