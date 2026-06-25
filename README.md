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
| AttestationRegistry | [`ecb2b8cc...3c57ca29`](https://testnet.cspr.live/contract/ecb2b8cc188254edc12d9f7f955fd000629fcfeef69c2912432d53053c57ca29) |
| PayoutVault | [`c5e07023...71ce36ae`](https://testnet.cspr.live/contract/c5e070238a6e818272fb9c27fa25929a79187b7f48136ff4355c956671ce36ae) |

**Request panel:** request id `823d1427b2bdfbae-mqsyp55n` · k=2 of 2 signers (claude-opus-4-8, claude-sonnet-4-6)

| Step | Transaction |
|---|---|
| Registry deploy (AttestationRegistry install) | [5210907205...bdcb639d](https://testnet.cspr.live/deploy/5210907205a89f96e74c0d90e568d6efd9eca757af5b337e36f395cfbdcb639d) |
| set_quorum(2) | [bad51736...6bbd84d9](https://testnet.cspr.live/deploy/bad5173640585ad62803a498b8444cc250875c0b8c88b3bf8b063e5b6bbd84d9) |
| set_trusted (onboard claude-sonnet-4-6 signer) | [e51338e2...620958f0](https://testnet.cspr.live/deploy/e51338e203df09ce440e44152948f906a818e3c1e845972cff612412620958f0) |
| set_challenge_window (open the fraud-proof window) | [b52be1a6...494898a7a](https://testnet.cspr.live/deploy/b52be1a6d5f7429e6971da458b77e1ddff7b671272da579d87553ff494898a7a) |
| Vault deploy (PayoutVault install) | [e61f23bb...62f8bc5a](https://testnet.cspr.live/deploy/e61f23bb5cc245cd2cde5da49bf202c6892a806a9f7052f4a76c28fb62f8bc5a) |
| Genuine attestation (claude-opus-4-8 signer) | [ee9ae7b5...5be3e301](https://testnet.cspr.live/deploy/ee9ae7b50754cfac19bda6f3b21608a75deaaf8cf051c3e52781395a5be3e301) |
| PayoutVault.release SUCCESS (quorum met, PAY) | [c1849015...6f7de077](https://testnet.cspr.live/deploy/c1849015bf503dcca17f3d659514f7674fa394254087d6fb8ab982696f7de077) |
| PayoutVault.release REVERT (poisoned, NoQuorum / User error 4) | [8fc53e67...dd6a3645](https://testnet.cspr.live/deploy/8fc53e670612a9148e52f8d5c9adf32c9744200ed2b6227dfaa5bcafdd6a3645) |

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

`PayoutVault` is the reference consumer. The payer escrows CSPR with `deposit(request_id, beneficiary)` — binding the beneficiary on-chain — then `release(request_id, output_hash)` calls `require_quorum` and, only on a verified output, transfers the escrowed CSPR to the bound beneficiary and emits `PayoutAuthorized` with the lead signer's reputation. If the output is poisoned or under-quorum, `release` reverts on-chain before a single mote moves — a failed deploy on the explorer, auditable and permanent. Escrow on a request that never reaches quorum is recoverable by the payer with `refund(request_id)`. (In the live testnet demo the beneficiary is bound with a zero-value escrow — Casper's JS SDK can't attach CSPR to a stored-contract call, so funding the purse with real CSPR uses Odra's `proxy_caller` session path, on the roadmap; the escrow transfer itself is covered by the contract test suite.)

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

## A primitive, not an app

Casproof is not one application that verifies one thing. It is a composable guard that any Casper contract composes to make its own action unskippable.

`registry.require_quorum(request_id, output_hash) → Address` is a single cross-contract call. It either passes — returning the lead attesting signer — or it reverts the entire transaction. A consuming contract that calls it as the first step of its action entrypoint gets atomic verify-and-act for free. The guard is the product; the consumer supplies the action.

### Four reference consumers, one guard

Each composes the *same* `require_quorum` guard as the first line of its action, and each ships with adversarial tests proving a poisoned or under-quorum output reverts before the action runs.

- **PayoutVault** — escrow a payout and release it only on a quorum-attested output. [Live on testnet](https://testnet.cspr.live/contract/c5e070238a6e818272fb9c27fa25929a79187b7f48136ff4355c956671ce36ae); [genuine → PAY](https://testnet.cspr.live/deploy/c1849015bf503dcca17f3d659514f7674fa394254087d6fb8ab982696f7de077), [poisoned → REVERT](https://testnet.cspr.live/deploy/8fc53e670612a9148e52f8d5c9adf32c9744200ed2b6227dfaa5bcafdd6a3645).
- **OutcomeEscrow** — *the kill move.* A faithful rebuild of the OutcomePay / Escrow402 outcome-escrow pattern (stake on a predicted outcome, pay the winner on resolution) — but `settle` cross-calls `require_quorum` first, so it physically cannot pay on an unverified or poisoned outcome. The exact pattern two of the strongest competitors ship, made unbypassable by sitting beneath it.
- **RWAValuationGate** — accept an RWA asset valuation only if it is quorum-attested, so downstream lending/collateral logic reads a value that provably passed k-of-n.
- **OracleGatedSwap** — execute a swap only on a quorum-attested price feed; proves the guard gates a non-payout action, not just payouts.

Four consumers. One `require_quorum`. No change to the guard API between them — `cd contract && cargo odra test` exercises all four, each with its bypass-attempt tests.

### Wrap any action in three lines

```rust
let signer = self.registry.require_quorum(request_id, output_hash); // reverts NoQuorum unless quorum-attested AND signers still trusted
// ...your value action runs only past this line, in the SAME VM call...
self.do_action(); // unbypassable: no off-chain step between check and act
```

### Where casproof sits in the stack

Other agent-economy entries are applications: they verify an output and act on it, each with their own two-step trust logic. Casproof sits one layer below. Vouch writes an off-chain k-of-n verdict and then acts — two steps with a window. verity checks reputation and proceeds — verify then act. Either could call `require_quorum` as the first line of their action entrypoint and close the gap without rebuilding their trust logic. OutcomeEscrow above is exactly that move, done for the escrow pattern.

Casproof is the slot the rest of the field plugs into. The guard is [live on Casper testnet](https://testnet.cspr.live/contract/ecb2b8cc188254edc12d9f7f955fd000629fcfeef69c2912432d53053c57ca29) — any Casper contract can cross-call it today.


## Security

### The gap the rest of the field leaves open

Most verify-before-act systems — and most entries in this buildathon — follow a two-step pattern: verify in one call, act in a separate call. Between those two steps there is a window. A misconfigured relay, a substituted output, or a simple off-chain bug can slip a different value through before the action fires. The consuming contract never detects the swap, because by the time it acts, the verification is already in the past.

Casproof closes that window with a single design decision: `require_quorum` is a cross-contract guard, not an advisory read. Any consuming contract calls it as the first step of its own action entrypoint. In Casper's WASM VM, that cross-call and the rest of the entrypoint execute in one atomic deployment. If the guard reverts, the entire transaction reverts — the action never starts. There is no gap.

### What was found and fixed

Before submission, the core contract underwent an adversarial audit. Two critical vulnerabilities were found and fixed; both would have made the "unskippable" pitch false.

**C1 — Quorum forgery via key collision.** The original agreement counter was keyed by concatenating `request_id + "#" + output_hash` as a raw string, with no validation that either input excluded the `#` character. A single trusted signer could submit three attestations with colliding framings — e.g., `("x", "x#x#x")`, `("x#x", "x#x")`, `("x#x#x", "x")` — all landing in the same counter cell while passing the per-signer dedup check as distinct votes. The counter reached k, the quorum latched, and `require_quorum` authorized the release. **k-of-n collapsed to k=1.** The fix replaces the string-concatenation key with a structured `(request_id, output_hash, signer)` tuple tracked in a boolean map, increments a separate `(request_id, output_hash)` tally only on first insertion, and rejects `#` at the `attest` boundary.

**C2 — Slashing cannot undo a reached quorum.** The original `quorum_output` was write-once permanent. Two colluding signers could latch a poisoned output hash, get slashed by the owner, and `require_quorum` would still authorize releases against that hash indefinitely — the gate passed after the very collusion it was supposed to stop. The fix makes `require_quorum` re-count only signers who are *currently trusted* at call time. Slashing the colluders reduces the live tally below threshold, and the gate reverts. Quorum is revocable, not permanent.

Two further issues were addressed: **H1** — `PayoutVault.release` now checks the caller is the authorized payer and binds the beneficiary on-chain at deposit time, so a public `(request_id, output_hash)` pair cannot be replayed by a stranger to redirect the payout to themselves; **M1** — the quorum threshold is snapshotted at a request's first attestation, so lowering `set_quorum` cannot retroactively seal an under-quorum in-flight request.

### Test coverage

`cd contract && cargo odra test` runs 61 tests across the registry, the four reference consumers, and the fraud-proof challenge window — covering the full attested lifecycle plus reputation, slashing, refund, ownership, and the challenge state machine; including adversarial regression tests that each reproduce a specific exploit and prove it is now blocked:

- `c1_collision_framings_cannot_forge_quorum` — the three colliding framings from the C1 audit produce three separate counters, none reaching quorum
- `c1_attest_rejects_separator_in_inputs` — `attest` reverts on inputs containing `#`
- `c2_slashing_revokes_a_reached_quorum` — slashing the colluders drops the live tally below k and `require_quorum` reverts
- `h1_unauthorized_caller_cannot_release` — a stranger cannot trigger release on a quorum-met request
- `h1_release_is_one_shot` — a second call to `release` on the same request reverts
- `m1_lowering_threshold_cannot_seal_an_inflight_request` — lowering `set_quorum` mid-flight does not seal an under-quorum request
- `m2_release_moves_escrowed_funds_only_on_quorum` — `release` transfers escrowed CSPR to the bound beneficiary after the guard passes, and reverts before a single mote moves when the guard fails
- `one_quorum_proof_cannot_stamp_a_different_asset_or_value` — a quorum on one (asset, valuation) cannot be replayed to stamp a different asset or a substituted value; the RWA gate binds the pair into the attested commitment
- `challenge_uphold_slashes_panel_and_revokes_quorum` / `stale_challenge_can_be_finalized_by_anyone` — the fraud-proof window slashes a fraudulent panel and revokes its quorum, and self-heals if the owner never resolves

Casproof is the only entry in this buildathon shipping adversarial tests that reproduce gate-bypass exploits and prove each one is closed. The four reference consumers and the challenge window are exercised by this OdraVM suite — the audited primitives; the **live** testnet demo runs PayoutVault end-to-end (the PAY / REVERT links above).

### Fraud-proof challenge window

Beyond "trust + slashing," Casproof ships an on-chain fraud-proof step toward verified computation. After a request reaches quorum, anyone may open a bonded `challenge(request_id, counter_hash)` within a configurable window, claiming a contradicting result. While a challenge is pending, `require_quorum` is frozen, so no consumer acts on a contested output. The owner calls `resolve_challenge`: **uphold** slashes every agreeing signer, permanently revokes the quorum (`require_quorum` reverts forever — any gated payout is dead), and returns the bond; **reject** keeps the quorum and forfeits the bond (kept in the vault, never paid to the owner, so the adjudicator has no motive to dismiss a real fraud-proof).

Two liveness guarantees back it: a value-bearing consumer can compose `require_final_quorum`, which waits out the window before passing — so it cannot be front-run by a quorum that is challenged and revoked moments later; and `finalize_stale_challenge` lets **anyone** clear a challenge the owner never resolves, so no dispute — and no renounced or absent owner — can freeze a payout forever.

This is owner-adjudicated optimistic verification today. Trustless resolution — a TEE/zkML recompute that adjudicates a challenge without an owner — is the roadmap; the challenge primitive is the slot it plugs into.

> The [live testnet registry](https://testnet.cspr.live/contract/ecb2b8cc188254edc12d9f7f955fd000629fcfeef69c2912432d53053c57ca29) above is the full hardened build: `challenge` / `resolve_challenge` / `finalize_stale_challenge` / `require_final_quorum` are deployed and the window is opened on-chain (the `set_challenge_window` tx in the table). The three additional reference consumers (OutcomeEscrow, RWAValuationGate, OracleGatedSwap) ship in the contract and are covered by the test suite; the live PAY/REVERT demo runs PayoutVault.


## Components

| Path | What it is |
|---|---|
| `contract/` | Five [Odra](https://odra.dev) (Rust → WASM) contracts: `AttestationRegistry` (quorum-native `attest`, composable `require_quorum` / `require_final_quorum` guards, slashable `reputation`, fraud-proof challenge window) and four reference consumers composing the guard — `PayoutVault`, `OutcomeEscrow`, `RWAValuationGate`, `OracleGatedSwap`. 61 OdraVM tests incl. adversarial bypass regressions. |
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
make test                # OdraVM unit tests (61 tests incl. adversarial bypass regressions)
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
