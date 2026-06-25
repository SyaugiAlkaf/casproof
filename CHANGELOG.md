# Changelog

All notable changes to Casproof are documented here. This project adheres to [Semantic Versioning](https://semver.org/).

## [1.0.0] — 2026-06-25

First public release — the verify-before-act firewall, live on Casper testnet.

### Added
- **AttestationRegistry** — `require_quorum(request_id, output_hash)` composable guard; k-of-n distinct-signer quorum on a byte-identical output hash; on-chain signer reputation with slashing; ownership transfer/renounce.
- **Fraud-proof challenge window** — `challenge` / `resolve_challenge` / `finalize_stale_challenge` and a maturity-gated `require_final_quorum`, with a permissionless self-heal path.
- **Four reference consumers**, each composing the same guard as the first line of its action: `PayoutVault`, `OutcomeEscrow`, `RWAValuationGate`, `OracleGatedSwap`.
- **Agents** — multi-model quorum producers, an autonomous verify-before-act consumer, deploy/setup/slash scripts, an MCP server (`casproof_verify_output`), and an x402-metered verify endpoint.
- **Verify dashboard** (Next.js) reading live Casper testnet state — genuine output pays, one tampered byte reverts.
- **Clients** — Python and JS SDKs for verify-before-act.
- **Docs** — README, `ARCHITECTURE.md`, launch plan, and an architecture diagram.

### Security
- Hardened the gate against the pre-release audit: fixed quorum-forgery via agreement-map key collision (C1), slash-revokes-quorum (C2), caller authorization and one-shot release (H1), threshold-snapshot per request (M1), and real escrow movement (M2).
- 61 OdraVM tests including adversarial bypass regressions for every consumer.

### Live on Casper testnet
- AttestationRegistry `ecb2b8cc188254edc12d9f7f955fd000629fcfeef69c2912432d53053c57ca29`
- PayoutVault `c5e070238a6e818272fb9c27fa25929a79187b7f48136ff4355c956671ce36ae`

[1.0.0]: https://github.com/SyaugiAlkaf/casproof/releases/tag/v1.0.0
