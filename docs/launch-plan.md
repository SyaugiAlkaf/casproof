# Casproof — Launch Plan and Demo Script

## Demo script (5 minutes)

The demo runs in two phases: the happy path (quorum → payout) and the tamper path (poisoned output → revert). Both produce real on-chain transactions.

### Setup (once, before demo)

```bash
cd agents

# Generate keys for the quorum panel; fund each once via the faucet
npm run keygen:quorum

# Deploy registry and vault, configure panel
npm run deploy && npm run resolve
# → paste REGISTRY_CONTRACT_HASH + REGISTRY_PACKAGE_HASH into .env

npm run deploy:vault && npm run resolve:vault
# → paste VAULT_CONTRACT_HASH into .env

# Set k=3 and trust all three panel signers on-chain
npm run setup
```

### Step 1 — Stake the claim: multi-model quorum

```bash
npm run demo
```

Three model agents independently call the Anthropic API with the same RWA valuation prompt. Each canonical-hashes its output (BLAKE2b-256) and attests on-chain with its own key. When the third agent votes, `QuorumReached` fires and `quorum_of(request_id)` is set. Three separate deploy hashes appear — one per model agent — each visible on the testnet explorer.

**Talking point:** "Three independent signers, three separate on-chain transactions, one byte-identical hash. No coordination off-chain is necessary — the math does it."

### Step 2 — PAY: consumer releases the payout

The demo's consumer agent reads `quorum_of(request_id)`, confirms it matches the output it received, and calls `PayoutVault.release(request_id, output_hash, beneficiary)`. The VM cross-calls the registry, confirms quorum, emits `PayoutAuthorized`. Paste the deploy hash into the explorer and show the event.

**Talking point:** "The verify-before-act decision is inside the Casper VM. No off-chain code can skip it."

### Step 3 — Tamper one byte: no quorum → release REVERTS

The demo replays the same request but substitutes a poisoned hash (one bit flipped in the payload before hashing). The poisoned hash has no matching `quorum_output` entry. `PayoutVault.release` reverts `NoQuorum`. The revert is a failed deploy on the explorer — on-chain, auditable, permanent.

**Talking point:** "The integrity layer refused the payout. No trusted agent signed this hash. The DeFi contract never had a choice."

### Close

> "Casproof is the integrity layer reputation oracles sit on top of. Other agents discover it over MCP, pay for reads over x402, and settle on Casper. The quorum is open: add your own oracle operator as a trusted signer and the guarantee scales with the panel."

---

## Roadmap

### Phase 1 — Testnet hardening (now → audit)

- Formal audit of `AttestationRegistry` and `PayoutVault` (Halborn or equivalent).
- Harden `set_trusted` with a multi-sig or timelock to prevent single-key panel capture.
- Complete the live x402 payment path (Casper EIP-712 signer integration).
- Expand the test suite: integration tests against a forked testnet state.

### Phase 2 — Multi-vendor oracle panel (3 months)

- Open the trusted-signer set to external oracle operators running independent model infrastructure (different cloud providers, different model families).
- Publish the oracle operator onboarding guide: generate key, fund key, call `set_trusted`, run the producer agent against your own models.
- The quorum becomes a multi-provider trust network rather than a single-operator panel. A threshold of k=5 across five independent operators is resistant to compromise of any single operator's infrastructure.
- Introduce attestation expiry: a timestamp-based validity window so time-sensitive valuations cannot be replayed after their useful life.

### Phase 3 — Mainnet deployment + SLA (6 months)

- Deploy to Casper mainnet after a passed audit.
- Run the x402 verify endpoint as a public, metered oracle service: per-read pricing in CSPR, settled through the hosted facilitator.
- Publish the Oracle SDK: `attest(payload)` and `verify(hash)` in under 10 lines, plus the MCP server config, so any RWA data provider can become a trusted signer in under an hour.
- SLA-backed oracle operators commit to uptime and response latency; reputation score (on-chain `attestation_count`) serves as a transparent quality signal.

### Phase 4 — Compliance integration (12 months)

- Map the trusted-signer set to ERC-3643-style permissioned issuers so attestations slot into regulated tokenized-asset workflows.
- Attestation of reasoning traces (not just final outputs) for high-stakes financial decisions requiring explainability.
- Reputation-weighted trust: consumers can require `reputation(signer) >= N` as an additional release condition, implemented as a second cross-contract call in `PayoutVault` or a new consumer contract variant.

---

## Long-term impact

Every layer of the AI-agent economy that transacts on model outputs — DeFi protocols consuming price feeds, RWA platforms consuming valuations, autonomous trading agents consuming risk scores — needs an answer to "did a source I trust actually produce this output, and was it tampered with?" before it can trust the accuracy layer above.

Casproof makes that a one-call, on-chain primitive. As the trusted-signer set grows to include independent oracle operators, the quorum becomes a decentralized integrity network. The MCP server makes it agent-discoverable. The x402 paywall makes it economically self-sustaining without a governance token. And because it is built on Casper's AI toolkit (Odra, casper-js-sdk, x402, CSPR.click), it is native infrastructure for every future agent that deploys on Casper — not a one-off application.
