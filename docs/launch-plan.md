# Casproof — Launch Plan and Demo Script

## Demo script (5 minutes)

The demo runs in two phases: the happy path (quorum → payout authorized) and the tamper path (poisoned output → VM revert). Both produce real on-chain transactions.

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

### Step 1 — Build the attestation record

```bash
npm run demo
```

Three independent signers each call the Anthropic API with the same RWA valuation prompt. Each canonical-hashes its output (BLAKE2b-256) and calls `attest(request_id, output_hash, model_id, prompt_hash)` on-chain with its own key. When the third signer's transaction lands, `QuorumReached` fires and `quorum_of(request_id)` is set to the agreed hash. Three separate deploy hashes appear on the testnet explorer — one per signer — each with `OutputAttested` in the event log.

**Talking point:** "Three independent signers, three separate on-chain transactions, one byte-identical hash. The registry records who signed, under which model and prompt hash, at which block. That is the audit trail."

### Step 2 — PAY: consumer releases the payout

The demo's consumer agent calls `PayoutVault.release(request_id, output_hash, beneficiary)`. The vault cross-calls `registry.require_quorum(request_id, output_hash)` inside the Casper VM. The guard passes; `PayoutAuthorized` is emitted with the lead signer's address and reputation score. Paste the deploy hash into the explorer and show the event.

**Talking point:** "The verify decision and the payout authorization happen in one atomic VM call. There is no gap between the check and the action. No off-chain agent, relay, or configuration flag can skip the gate — it is enforced by the WASM runtime."

### Step 3 — Tamper one byte: require_quorum reverts in-VM → payout withheld

The demo replays the same request but substitutes a poisoned hash (one bit flipped in the payload before hashing). The poisoned hash has no matching `quorum_output` entry. `require_quorum` reverts `NoQuorum` inside the VM. `PayoutVault.release` reverts entirely. The explorer shows a failed deploy — on-chain, auditable, permanent.

**Talking point:** "The firewall refused the payout. The revert is not a log entry or a flag in a database — it is a failed deploy on the Casper testnet. No value moved. No off-chain agent had a choice."

### Step 4 — Slash a bad actor (optional live demo)

```bash
npm run slash -- <account-hash-of-bad-signer>
```

Owner calls `slash(signer)`: trust is revoked, `slashes[signer]` increments, `reputation(signer)` falls, `SignerSlashed` is emitted. The slashed signer can no longer attest until explicitly re-trusted.

**Talking point:** "Today the trusted set is owner-curated. Slashing gives curators a tool to penalize misbehavior and reduce the signer's standing. On the roadmap, bonded stake replaces curation — capital at risk, not just reputation."

### Close

> "Casproof is the enforcement layer AI agent pipelines in regulated finance are missing. The audit trail is on-chain and permanent. The verify gate is enforced by the VM and cannot be skipped. Any contract composes it with one cross-contract call. The proof source behind the gate — today it is a curated quorum; tomorrow it is a TEE receipt or a zkML proof — is pluggable. The gate stays the same."

---

## Roadmap

### Phase 1 — Action firewall (now)

The `require_quorum` guard, slashable reputation, and `PayoutVault` are deployed and tested (19 OdraVM unit tests). The current state:

- Trusted signer set is owner-curated. Owner controls `set_trusted`, `slash`.
- Reputation is `attestation_count - slashes` (on-chain, portable, emitted in every `PayoutAuthorized`).
- Quorum (k of n distinct trusted signers attesting byte-identical hash) is the live attestation policy.
- Any consuming contract can compose `require_quorum` today. The API will not change as proof sources evolve.

Hardening before mainnet:
- Formal audit of `AttestationRegistry` and `PayoutVault` (Halborn or equivalent).
- Multi-sig or timelock on `set_trusted` and `set_quorum` to prevent single-key panel capture.
- Complete the live x402 payment path (Casper EIP-712 signer integration).
- Integration tests against a forked testnet state.

### Phase 2 — Pluggable proof sources (3–6 months)

Replace or supplement the curated signer with proof-of-computation evidence. The `require_quorum` gate does not change; what changes is the evidence `attest()` accepts.

**TEE remote-attestation:** Signers running in a Trusted Execution Environment (Intel TDX, AMD SEV-SNP) submit a TEE quote alongside the attestation. The registry contract (or an on-chain verifier contract it calls) checks the quote before accepting the attestation. A signer cannot attest a hash without proving the computation ran in a TEE on a specific input. This eliminates the copy attack: the quote binds the computation to the hardware.

**zkML proofs:** Off-chain ML inference produces a zero-knowledge proof that the model with a specific committed weight hash produced a specific output from a specific input. The proof is verified in the contract before the attestation is accepted. This is the strongest form — the signer cannot lie about what the model produced, regardless of how the signer's keys are managed.

**Optimistic re-execution:** Any node can re-run the computation and submit a challenge within a window. If the challenge succeeds, the original attester is slashed. No ZK overhead; appropriate for lower-stakes valuations.

All three proof sources compose with the same `require_quorum` gate. Consumers built on the current interface remain compatible.

### Phase 3 — Staking and economic security (6–9 months)

Replace owner-curated slashing with bonded stake:
- Signers post collateral (CSPR or a stablecoin) on registration.
- A successful slash burns a portion of the stake, not just reputation.
- Slashing triggers are governed by a committee or a challenge protocol (optimistic re-execution, Phase 2).
- Reputation score becomes the basis for stake-weighted quorum: consumers can require `reputation(signer) >= N` as an additional release condition.

The `slash` entrypoint and the `SignerSlashed` event are already in the contract. The staking layer plugs into the existing enforcement hook.

### Phase 4 — Mainnet, Oracle SDK, and compliance integration (9–12 months)

- Deploy to Casper mainnet after a passed audit.
- Run the x402 verify endpoint as a public, metered oracle service: per-read pricing in CSPR, settled through the hosted facilitator.
- Publish the Oracle SDK: `attest(payload)` and composing `require_quorum` in under 10 lines, plus the MCP server config, so any AI data provider can become a trusted signer in under an hour.
- Map the trusted-signer set to ERC-3643-style permissioned issuers so attestations slot into regulated tokenized-asset workflows (the AI compliance and liability audit-trail use case).
- Attestation of reasoning traces (not just final outputs) for high-stakes financial decisions requiring explainability under regulation.

---

## Market wedge

The primary wedge is **AI compliance and liability audit-trail for regulated finance**, not RWA valuation as a data type (Chainlink owns that).

The question regulators and risk functions ask is: "Can you prove the AI output your system acted on was the genuine, unmodified result from sources you were authorized to use, at a specific time, with an immutable record?" Casproof answers that question with an on-chain receipt that cannot be edited after the fact, enforced at the action layer — not just logged.

The demo scenario (RWA valuation gating a DeFi payout) is concrete and shows the failure mode live. The addressable market is every regulated entity deploying AI agents that make or assist value-bearing decisions: asset managers, RWA platforms, trading desks, insurance underwriters. Casper's focus on compliant tokenized assets and ERC-3643-style issuance positions Casproof as native infrastructure for that audience.

---

## Long-term impact

Every layer of the AI-agent economy that transacts on model outputs needs the answer to "did a source I trust actually produce this output, and was the action gated on that proof?" before it can trust the accuracy layer above.

Casproof makes that a one-call, on-chain primitive. The `require_quorum` guard is the slot that any future proof-of-computation scheme plugs into: the proof of computation is the proof source's contribution; the unskippable on-chain settlement gate is Casproof's. By exposing it over MCP and metering it with x402, it becomes infrastructure rather than a single application — native to every future agent that deploys on Casper.
