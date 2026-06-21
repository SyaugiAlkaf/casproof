# Casproof

[![ci](https://github.com/SyaugiAlkaf/casproof/actions/workflows/ci.yml/badge.svg)](https://github.com/SyaugiAlkaf/casproof/actions/workflows/ci.yml)

**Verifiable proof of AI agent outputs on the Casper Network.**

An autonomous agent that produces a result — a price feed, a risk score, an RWA valuation — can publish a cryptographic attestation of that result on-chain: which model produced it, under which prompt, signed by which agent, at which block time. Any other agent can verify that attestation before trusting the output and acting on it. With a multi-model quorum panel, a result is only accepted when k of n independent trusted signers attest the byte-identical hash — a tampered or substituted output diverges and cannot reach quorum.

![Casproof dashboard — verify an AI agent output on-chain, and watch a poisoned feed get blocked](docs/dashboard.png)

## Live on Casper testnet

All transactions below are on `casper-test`. Paste the deploy hashes after running the commands in the Quickstart section.

| Step | Command | Transaction |
|---|---|---|
| Registry deploy | `npm run deploy` | `https://testnet.cspr.live/deploy/<paste after npm run deploy>` |
| Vault deploy | `npm run deploy:vault` | `https://testnet.cspr.live/deploy/<paste after npm run deploy:vault>` |
| Set quorum (k=3) | `npm run setup` | `https://testnet.cspr.live/deploy/<paste after npm run setup>` |
| Model-A attest | `npm run demo` (agent 0) | `https://testnet.cspr.live/deploy/<paste agent-0 tx hash>` |
| Model-B attest | `npm run demo` (agent 1) | `https://testnet.cspr.live/deploy/<paste agent-1 tx hash>` |
| Model-C attest | `npm run demo` (agent 2) | `https://testnet.cspr.live/deploy/<paste agent-2 tx hash>` |
| PayoutVault.release (quorum met) | `npm run demo` (consumer, genuine) | `https://testnet.cspr.live/deploy/<paste release tx hash>` |
| PayoutVault.release REVERT (poisoned) | `npm run demo` (consumer, poisoned) | `https://testnet.cspr.live/deploy/<paste revert tx hash>` |

> Deploy is human-gated (faucet funds each key once). Run the Quickstart commands and paste the printed deploy hashes above.

## The problem

Casper's thesis is to be the trust layer for the agent economy. But on a chain that sells *verifiable AI*, there is currently no open, on-chain way to verify what an AI agent actually produced. Agents consume each other's outputs — feeds, scores, signals — with no way to know whether an output is the genuine model result or has been swapped, replayed, or tampered with. The first agent that acts on a poisoned feed loses real money.

More precisely, the gap is at the **integrity layer**: before you can ask "is this output accurate?", you must be able to ask "is this output the genuine, untampered result of model X on prompt Y?" Casproof answers the second question on-chain, providing a trustless foundation that subjective accuracy oracles and reputation systems sit on top of.

Casproof closes that gap with a quorum-native registry contract, a multi-model agent panel, an on-chain verify-gate, an x402-metered verification endpoint, and a dashboard that shows the failure mode live.

## How it works

![Casproof architecture — multi-model producer panel attests on-chain, consumer agent verifies before paying, exposed over MCP and metered with x402](docs/architecture.png)

### Multi-model quorum (the core integrity guarantee)

Instead of a single producer, Casproof runs a panel of independent trusted model agents — each signs with its own on-chain key and calls `attest(request_id, output_hash, model_id, prompt_hash)` on the registry. The registry accumulates a distinct-signer count per `(request_id, output_hash)` pair. When k of n distinct trusted signers have attested the byte-identical hash for the same request, the request is **quorum-attested** and the `QuorumReached` event fires once. The winning hash is recorded at `quorum_of(request_id)`.

The check is deterministic — pure hash equality, never an opinion poll. A single swapped or tampered model produces a different hash; that hash increments its own agreement counter independently and cannot merge into the agreeing set. Quorum is physically unreachable for any output hash that did not emerge from at least k independent signers running the same computation. A one-signer-per-request guard (`voted` mapping, keyed by `(request_id, signer)`) prevents a single compromised key from voting multiple times to stuff the count.

Output hashing is canonical: keys are sorted, the JSON is deterministic, and the digest is BLAKE2b-256 (32 bytes hex). The same payload always produces the same hash regardless of serialization order. The prompt is hashed separately so a verifier can confirm what was asked without the registry storing prompt text.

### On-chain verify-gate (PayoutVault)

An off-chain consumer could be patched to skip the check. Casproof ships a second contract, `PayoutVault`, whose `release(request_id, output_hash, beneficiary)` **cross-calls `quorum_of(request_id)` on the registry inside the Casper VM** and reverts (`NoQuorum`) unless the presented hash matches the quorum result. A poisoned feed produces a different hash; `release` reverts on-chain, and the revert is visible on the explorer as a failed deploy. No off-chain agent can override this — the verify-before-act decision is enforced by the VM.

A successful release emits `PayoutAuthorized` with the lead signer's address and reputation score (portable on-chain attestation count), so the beneficiary and downstream consumers have an auditable trail.

### Integrity vs. accuracy

Casproof proves **provenance and integrity**: is this the genuine, untampered output of model X on prompt Y, produced by at least k independent trusted signers? It does not assert that the output is correct. Accuracy oracles, financial validators, and reputation-weighting systems sit on top of this layer: they can assume the hash they receive has not been tampered with, because the registry and quorum mechanics guarantee it.

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
| `contract/` | Two [Odra](https://odra.dev) (Rust → WASM) contracts: `AttestationRegistry` (k-of-n quorum, trusted-signer-gated `attest`, `verify`, on-chain `reputation`) and `PayoutVault` — a DeFi consumer that cross-calls the registry inside the VM and reverts unless the output reached quorum. |
| `agents/` | TypeScript multi-model producer panel, autonomous consumer agent, on-chain read library, x402 verify server, MCP server, and keygen/deploy/resolve/setup scripts (`casper-js-sdk` v5, Anthropic API). |
| `ui/` | Next.js dashboard (CSPR.click wallet connect) — verify an output, show the attestation badge and explorer link, and the live poison→block contrast screen. |

**Casproof in the Casper stack:** Odra (contract) · casper-js-sdk v5 (agents) · x402 facilitator (metered reads) · MCP (agent discovery) · CSPR.click (dashboard wallet) — four of Casper's flagship AI-toolkit components, composed into one verifiable-inference primitive.

## Quick start

### Prerequisites

- Rust + the [cargo-odra](https://github.com/odradev/cargo-odra) CLI (`cargo install cargo-odra`). The contract pins `nightly-2026-01-01` via `contract/rust-toolchain.toml`; `wasm-opt`/`wasm-strip` (binaryen + wabt) are used to shrink the wasm.
- Node 20+.
- Funded Casper **testnet** keys ([faucet](https://testnet.cspr.live/tools/faucet)). The faucet funds a key once — use a fresh keypair per key role. The quorum panel needs one funded key per model agent.

### Contract

```bash
cd contract
make test                # OdraVM unit tests (= cargo odra test)
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

# 7. Run the full demo (multi-model quorum → PAY, poisoned → REVERT)
npm run demo
```

### Individual agents

```bash
npm run producer         # one model agent: produce an RWA valuation + attest on-chain
npm test                 # unit tests (+ deploy-gated integration test)
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

## Why Casper

- **Real-world assets and DeFi.** The reference flow is a multi-model RWA valuation gating a DeFi payout — the regulated, value-bearing machine-to-machine use case Casper targets, aligned with the Casper Manifest's focus on compliant (ERC-3643-style) tokenized assets.
- **Agent-native.** Producer and consumer are autonomous agents; they discover Casproof over MCP, pay for verification over x402, and settle on-chain — the exact agent loop Casper's AI toolkit is designed for.
- **Honest on-chain.** Every attestation is a real testnet transaction; verification reads real contract state; the quorum and verify-gate are enforced by the contract, not by client configuration. Nothing is mocked in the trust path.

## Design notes

- Output hashing is canonical (keys sorted, deterministic JSON, BLAKE2b-256) so the same payload always hashes identically regardless of serialization. Every model agent in the panel runs the same canonical hash before attesting.
- `attest()` reverts for untrusted callers and for duplicate votes (one-vote-per-signer-per-request enforced in storage). An on-chain attestation is itself proof a trusted signer produced it.
- `PayoutVault.release()` performs two cross-contract calls in a single VM execution: `quorum_of(request_id)` and `verify(output_hash)`. Both must agree for the release to succeed.
- All chain calls live in one module (`agents/src/casper.ts`); the storage-key derivation that lets the consumer read the registry without an indexer is unit-tested against a fixed vector.

## Launch plan

See [docs/launch-plan.md](docs/launch-plan.md) for the full roadmap.

The short version:
1. **Audit + mainnet.** Harden and audit both contracts, deploy to Casper mainnet.
2. **Multi-vendor oracle panel.** Open the trusted-signer set to external oracle operators running independent model infrastructure, turning the quorum into a multi-provider trust network.
3. **Oracle SDK.** Publish a small SDK (`attest`/`verify` in two calls) plus the MCP server so any RWA data provider can become a trusted signer and any DeFi agent can verify-before-act.
4. **Metered attestation as revenue.** The x402 paywall lets signer-operators charge per verified read — a self-sustaining business model for running an attestation oracle.
5. **Compliance fit.** Map the trusted-signer set to ERC-3643-style permissioned issuers so attestations slot into regulated tokenized-asset workflows.

## Long-term impact

As agents increasingly transact on each other's outputs, "is this the genuine, untampered model result from sources I trust?" becomes a settlement-critical question. Casproof makes that a one-call, on-chain primitive — the integrity layer other Casper agents build on. By exposing it over MCP and metering it with x402, it becomes infrastructure rather than a single application. The registry already tracks portable signer reputation (attestation count per signer) on-chain; natural extensions: reputation-weighted trust, attestation of reasoning traces, multi-provider oracle panels for high-value feeds, and attestation expiry for time-sensitive valuations.

## License

Apache-2.0
