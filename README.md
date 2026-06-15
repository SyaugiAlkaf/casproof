# Casproof

**Verifiable proof of AI agent outputs on the Casper Network.**

An autonomous agent that produces a result — a price feed, a risk score, an RWA valuation — can publish a cryptographic attestation of that result on-chain: which model produced it, under which prompt, signed by which agent, at which block time. Any other agent can check that attestation before trusting the output and acting on it.

Casproof is the open, agent-economy version of [Prove AI](https://prove.ai) — Casper Labs' own commercial verifiable-AI product — built natively for autonomous agents that pay, attest, and verify on-chain.

## The problem

Casper's thesis is to be the trust layer for the agent economy. But on a chain that sells *verifiable AI*, there is currently no open, on-chain way to verify what an AI agent actually produced. Agents consume each other's outputs — feeds, scores, signals — with no way to know whether an output is the genuine model result or has been swapped, replayed, or tampered with. The first agent that acts on a poisoned feed loses real money.

Casproof closes that gap with a registry contract, two reference agents, an x402-metered verification endpoint, and a dashboard that shows the failure mode live: poison the feed, and the consumer refuses to pay.

## How it works

```
  ┌──────────────────┐        attest(output_hash,           ┌────────────────────────┐
  │  Producer agent  │        model_id, prompt_hash)        │  AttestationRegistry   │
  │  (Anthropic LLM) │ ───────────────────────────────────▶ │  (Odra → WASM, testnet)│
  │  prices an RWA   │        real testnet transaction      │  output_hash → record  │
  └──────────────────┘                                      └───────────┬────────────┘
                                                                        │ state read (RPC)
  ┌──────────────────┐        verify(output_hash)                       │ or x402-metered
  │  Consumer agent  │ ◀────────────────────────────────────────────────┘
  │  (DeFi payout)   │   attested by a trusted signer? ── yes ─▶ release payout
  └──────────────────┘                              └──────── no ──▶ BLOCK, log refusal
```

1. **Producer agent** generates an output (here: an RWA valuation for a tokenized parking-revenue note), hashes the payload deterministically (BLAKE2b-256 over a canonical JSON encoding), and calls `attest(output_hash, model_id, prompt_hash)` on the registry. The attestation is a real on-chain transaction that emits an `OutputAttested` event.
2. **Consumer agent** — a DeFi agent about to release a payout against that feed — recomputes the hash and looks it up in the registry. It releases funds only if the output is attested by a trusted signer. A tampered or unattested feed produces a different hash, finds no attestation, and is refused.

The consumer reads the attestation **straight from the contract's state in the node** (no indexer, no API key required), by re-deriving the Odra storage key for the registry's `attestations` mapping and querying the dictionary item over RPC. CSPR.cloud's event index is supported as a fallback.

### Metered verification (x402)

Verification can be sold per-read. The `/verify` endpoint is paywalled with [x402](https://x402.org): an unpaid request gets `402 Payment Required` with Casper payment requirements (`casper:casper-test`); the client attaches an `X-PAYMENT` header; the request is settled through the hosted Casper facilitator (`x402-facilitator.cspr.cloud`); only then does the endpoint perform the real on-chain read. An oracle operator earns per verified read while agents pay only for what they consume.

## Components

| Path | What it is |
|---|---|
| `contract/` | `AttestationRegistry` — an [Odra](https://odra.dev) (Rust → WASM) smart contract for Casper. `attest`, `verify`, trusted-signer allow-list. |
| `agents/` | TypeScript producer + consumer agents, the on-chain read library, the x402 verify server, and the deploy/resolve scripts (`casper-js-sdk` v5, Anthropic API). |
| `ui/` | Next.js dashboard (CSPR.click wallet connect) — verify an output, show the attestation badge + explorer link, and the live poison→block contrast screen. |

## Quick start

### Prerequisites
- Rust + the [cargo-odra](https://github.com/odradev/cargo-odra) CLI (`cargo install cargo-odra`). The contract pins `nightly-2026-01-01` via `contract/rust-toolchain.toml`; `wasm-opt`/`wasm-strip` (binaryen + wabt) are used to shrink the wasm.
- Node 20+.
- A funded Casper **testnet** key ([faucet](https://testnet.cspr.live/tools/faucet)). The faucet funds a key once — use a fresh keypair.

### Contract
```bash
cd contract
make test                # OdraVM unit tests  (= cargo odra test)
make build               # build + wasm-opt -Oz → wasm/AttestationRegistry.wasm (~192 KB)
```
`make build` runs `cargo odra build` then shrinks the wasm with `wasm-opt -Oz` to lower install gas; plain `cargo odra build` works too.

### Agents
```bash
cd agents
npm install
cp ../.env.example ../.env       # fill in keys + RPC + (after deploy) the contract hash

npm run deploy                   # install the registry on testnet (uses PRODUCER_KEY_PATH)
npm run resolve                  # print REGISTRY_CONTRACT_HASH from your account's named keys
#   → paste it into .env

npm run producer                 # produce an RWA valuation + attest it on-chain (prints tx + explorer link)
npm run demo                     # full story: genuine feed → PAY, poisoned feed → BLOCK
npm test                         # unit tests (+ a deploy-gated integration test)
```

### Metered verification (x402)
```bash
cd agents
npm run x402:server              # GET /verify?hash=<outputHash>, paywalled with x402
npm run x402:verify <outputHash> # client: handles 402 → pay → retry, prints the verified result
```

### Dashboard
```bash
cd ui
npm install
cp .env.example .env.local       # CASPER_CHAIN_RPC + REGISTRY_CONTRACT_HASH
npm run dev                      # http://localhost:3000
```

## Why Casper

- **Real-world assets & DeFi.** The reference flow is an RWA valuation gating a DeFi payout — exactly the regulated, value-bearing machine-to-machine use case Casper targets.
- **Agent-native.** Producer and consumer are autonomous agents; attestation and verification are agent-to-agent, metered with x402, the protocol Casper ships for autonomous payments.
- **Honest on-chain.** Every attestation is a real testnet transaction; verification reads real contract state. Nothing is mocked in the trust path.

## Design notes

- Output hashing is canonical (keys sorted) so the same payload always hashes identically regardless of serialization. The prompt is hashed separately so a verifier can confirm *what was asked* without the registry storing prompt text.
- The contract rejects duplicate attestations and gates the trusted-signer list behind an owner check.
- All chain calls live in one module (`agents/src/casper.ts`); the storage-key derivation that lets the consumer read the registry without an indexer is unit-tested against a fixed vector.

## Roadmap

- Portable agent reputation derived from attestation history
- Attestation of model reasoning traces, not just final outputs
- A published SDK so any Casper agent can attest and verify in two calls
- Multi-signer quorums for high-value feeds

## License

Apache-2.0
