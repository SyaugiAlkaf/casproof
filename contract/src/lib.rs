#![cfg_attr(not(test), no_std)]
#![cfg_attr(not(test), no_main)]
extern crate alloc;

use odra::prelude::*;
use odra::casper_types::U512;
use odra::casper_types::bytesrepr::ToBytes;

/// A single agent's attestation of an AI output. One record is kept per distinct
/// `output_hash` (the first signer to attest it writes the record); `reputation`
/// and `agreement` track the rest.
#[odra::odra_type]
pub struct Attestation {
    pub signer: Address,
    pub request_id: String,
    pub model_id: String,
    pub prompt_hash: String,
    pub timestamp: u64,
}

/// Emitted on every accepted attestation (one per trusted signer per request).
#[odra::event]
pub struct OutputAttested {
    pub request_id: String,
    pub output_hash: String,
    pub model_id: String,
    pub signer: Address,
    pub timestamp: u64,
}

/// Emitted once, when `threshold` distinct trusted signers have independently
/// attested the *same* `output_hash` for a request. This is the integrity signal
/// a consumer acts on: k of n models agreed on the byte-identical result.
#[odra::event]
pub struct QuorumReached {
    pub request_id: String,
    pub output_hash: String,
    pub threshold: u32,
    pub agreed: u32,
}

/// Emitted when the owner slashes a signer found to have diverged or colluded.
/// Slashing revokes trust and reduces the signer's standing — the skin-in-the-game
/// that keeps the trusted set honest until staking lands on the roadmap.
#[odra::event]
pub struct SignerSlashed {
    pub signer: Address,
}

/// Emitted when a fraud-proof challenge is opened against a reached quorum within the window.
#[odra::event]
pub struct ChallengeOpened {
    pub request_id: String,
    pub challenger: Address,
    pub counter_hash: String,
}

/// Emitted when the owner upholds a challenge: the agreeing panel is slashed and the quorum revoked.
#[odra::event]
pub struct ChallengeUpheld {
    pub request_id: String,
    pub revoked_hash: String,
}

/// Emitted when the owner rejects a challenge: the quorum stands and the challenger's bond is forfeited.
#[odra::event]
pub struct ChallengeRejected {
    pub request_id: String,
}

#[odra::odra_error]
pub enum Error {
    NotOwner = 1,
    NotTrusted = 2,
    NotAttested = 3,
    NoQuorum = 4,
    AlreadyVoted = 5,
    InvalidQuorum = 6,
    InvalidInput = 7,
    NotAuthorized = 8,
    AlreadyReleased = 9,
    AlreadyRefunded = 10,
    ChallengeWindowClosed = 11,
    AlreadyChallenged = 12,
    ChallengePending = 13,
    NotChallenged = 14,
}

/// Quorum-native attestation registry.
///
/// A *request* (`request_id`, deterministically derived from the prompt) is
/// answered independently by several trusted agents, each running a different
/// model. Every agent canonical-hashes its output and attests that hash. An
/// output becomes **quorum-attested** only when `quorum_threshold` *distinct*
/// trusted signers attest the byte-identical `output_hash` for that request.
///
/// The check is deterministic — pure hash equality, never an opinion poll — so a
/// single swapped or tampered model produces a different hash, fails to add to the
/// agreeing set, and cannot reach quorum. Quorum is one pluggable attestation policy
/// behind the unskippable on-chain verify-before-act gate (`require_quorum` /
/// PayoutVault); proof-of-computation receipts (TEE/zk) are the roadmap source.
#[odra::module(events = [OutputAttested, QuorumReached, SignerSlashed, ChallengeOpened, ChallengeUpheld, ChallengeRejected])]
pub struct AttestationRegistry {
    owner: Var<Address>,
    // once true, ownership is renounced — every owner-only entrypoint reverts permanently,
    // freezing the configured trusted panel and removing the owner single-point-of-failure.
    renounced: Var<bool>,
    quorum_threshold: Var<u32>,
    trusted: Mapping<Address, bool>,
    attestation_count: Mapping<Address, u64>,
    attestations: Mapping<String, Attestation>,
    // distinct-signer agreement count, keyed by the structured pair (request_id, output_hash).
    agreement: Mapping<(String, String), u32>,
    // dedup guard: signers already counted toward a given (request_id, output_hash).
    attested: Mapping<(String, String, Address), bool>,
    // the agreeing signers per pair, indexed 1..=agreement, so the gate can re-count
    // how many are STILL trusted at call time (a slashed signer no longer counts).
    agree_signers: Mapping<(String, String, u32), Address>,
    // threshold snapshotted at a request's first attestation; a later set_quorum affects
    // only NEW requests, never retroactively (un)seals an in-flight one.
    req_threshold: Mapping<String, u32>,
    // winning output hash once quorum is reached, keyed by request_id.
    quorum_output: Mapping<String, String>,
    // one-vote-per-signer-per-request guard, keyed by (request_id, signer).
    voted: Mapping<(String, Address), bool>,
    // slash count per signer; subtracted from standing so lying cannot pay off.
    slashes: Mapping<Address, u64>,
    // permanent disqualification: a slashed signer never counts toward quorum again,
    // even if re-trusted — slashing is sticky for the gate.
    slashed: Mapping<Address, bool>,
    // --- Phase 4: fraud-proof challenge window (appended; off-chain read indices unchanged) ---
    // window (block-time ms) after quorum during which a challenge may be opened; 0 = disabled.
    challenge_window: Var<u64>,
    // block time a request reached quorum (start of its challenge window).
    quorum_time: Mapping<String, u64>,
    // a challenge is open and unresolved for this request.
    challenged: Mapping<String, bool>,
    // quorum permanently revoked by an upheld challenge — require_quorum reverts forever.
    revoked: Mapping<String, bool>,
    challenger: Mapping<String, Address>,
    counter_hash: Mapping<String, String>,
    challenge_bond: Mapping<String, U512>,
}

#[odra::module]
impl AttestationRegistry {
    /// Deploys with the caller as owner and sole trusted signer, and a default
    /// threshold of 1 (single-signer attestations are immediately quorum-attested).
    /// Raise the threshold with `set_quorum` and onboard signers with `set_trusted`.
    pub fn init(&mut self) {
        let caller = self.env().caller();
        self.owner.set(caller);
        self.trusted.set(&caller, true);
        self.quorum_threshold.set(1);
    }

    /// A trusted agent attests `output_hash` as its answer to `request_id`.
    /// Reverts for an untrusted caller or a second vote on the same request.
    /// When the count of distinct signers agreeing on this exact hash reaches the
    /// threshold, the request is recorded as quorum-attested and `QuorumReached`
    /// fires once.
    pub fn attest(
        &mut self,
        request_id: String,
        output_hash: String,
        model_id: String,
        prompt_hash: String,
    ) {
        let signer = self.env().caller();
        if !self.trusted.get(&signer).unwrap_or(false) {
            self.env().revert(Error::NotTrusted);
        }
        // Reject the separator so request_id/output_hash framings can never collide
        // into one agreement cell (belt-and-suspenders over the structured tuple key).
        if request_id.contains('#') || output_hash.contains('#') {
            self.env().revert(Error::InvalidInput);
        }
        let vote = (request_id.clone(), signer);
        if self.voted.get(&vote).unwrap_or(false) {
            self.env().revert(Error::AlreadyVoted);
        }
        self.voted.set(&vote, true);

        let timestamp = self.env().get_block_time();
        if self.attestations.get(&output_hash).is_none() {
            self.attestations.set(
                &output_hash,
                Attestation {
                    signer,
                    request_id: request_id.clone(),
                    model_id: model_id.clone(),
                    prompt_hash,
                    timestamp,
                },
            );
        }
        self.attestation_count.add(&signer, 1);

        // Count this signer toward the (request_id, output_hash) pair exactly once.
        let pair = (request_id.clone(), output_hash.clone());
        let signer_key = (request_id.clone(), output_hash.clone(), signer);
        let agreed = if self.attested.get(&signer_key).unwrap_or(false) {
            self.agreement.get(&pair).unwrap_or(0)
        } else {
            self.attested.set(&signer_key, true);
            let n = self.agreement.get(&pair).unwrap_or(0) + 1;
            self.agreement.set(&pair, n);
            self.agree_signers
                .set(&(request_id.clone(), output_hash.clone(), n), signer);
            n
        };

        self.env().emit_event(OutputAttested {
            request_id: request_id.clone(),
            output_hash: output_hash.clone(),
            model_id,
            signer,
            timestamp,
        });

        // Snapshot the threshold this request was opened under, on its first attestation.
        let threshold = match self.req_threshold.get(&request_id) {
            Some(t) => t,
            None => {
                let t = self.quorum_threshold.get().unwrap_or(1);
                self.req_threshold.set(&request_id, t);
                t
            }
        };
        if agreed >= threshold && self.quorum_output.get(&request_id).is_none() {
            self.quorum_output.set(&request_id, output_hash.clone());
            self.quorum_time.set(&request_id, self.env().get_block_time());
            self.env().emit_event(QuorumReached {
                request_id,
                output_hash,
                threshold,
                agreed,
            });
        }
    }

    /// The base attestation record for an output hash (the first signer to attest
    /// it), or `None` if no agent has ever attested this hash.
    pub fn verify(&self, output_hash: String) -> Option<Attestation> {
        self.attestations.get(&output_hash)
    }

    /// The quorum-attested output hash for a request, or `None` if no output has
    /// yet reached the threshold. This is the value a consumer gates a payout on.
    pub fn quorum_of(&self, request_id: String) -> Option<String> {
        self.quorum_output.get(&request_id)
    }

    /// The composable verify-before-act guard. Reverts unless `output_hash` is the
    /// quorum-attested result for `request_id` AND at least `threshold` of its agreeing
    /// signers are STILL trusted right now — so a quorum reached by signers later slashed
    /// no longer passes. Returns a still-trusted lead signer who attested this request.
    /// Any contract cross-calls this so verify-and-act run in one atomic VM call.
    pub fn require_quorum(&self, request_id: String, output_hash: String) -> Address {
        // A quorum revoked by an upheld fraud-proof challenge never passes again; a quorum
        // with a challenge pending is frozen until the owner resolves it.
        if self.revoked.get(&request_id).unwrap_or(false) {
            self.env().revert(Error::NoQuorum);
        }
        if self.challenged.get(&request_id).unwrap_or(false) {
            self.env().revert(Error::ChallengePending);
        }
        match self.quorum_output.get(&request_id) {
            Some(winner) if winner == output_hash => {
                let pair = (request_id.clone(), output_hash.clone());
                let count = self.agreement.get(&pair).unwrap_or(0);
                let threshold = self
                    .req_threshold
                    .get(&request_id)
                    .unwrap_or_else(|| self.quorum_threshold.get().unwrap_or(1));
                let mut still_trusted = 0u32;
                let mut lead: Option<Address> = None;
                let mut i = 1u32;
                while i <= count {
                    if let Some(signer) =
                        self.agree_signers.get(&(request_id.clone(), output_hash.clone(), i))
                    {
                        if self.trusted.get(&signer).unwrap_or(false)
                            && !self.slashed.get(&signer).unwrap_or(false)
                        {
                            still_trusted += 1;
                            if lead.is_none() {
                                lead = Some(signer);
                            }
                        }
                    }
                    i += 1;
                }
                match lead {
                    Some(signer) if still_trusted >= threshold => signer,
                    _ => self.env().revert(Error::NoQuorum),
                }
            }
            _ => self.env().revert(Error::NoQuorum),
        }
    }

    /// How many distinct trusted signers have attested this exact output for this
    /// request (the live "k of n agree" figure).
    pub fn agreement_count(&self, request_id: String, output_hash: String) -> u32 {
        self.agreement.get(&(request_id, output_hash)).unwrap_or(0)
    }

    pub fn threshold(&self) -> u32 {
        self.quorum_threshold.get().unwrap_or(1)
    }

    pub fn is_trusted(&self, signer: Address) -> bool {
        self.trusted.get(&signer).unwrap_or(false)
    }

    /// Portable agent reputation: outputs attested, net of slashes. Slashing makes the
    /// score fall, so a signer that lies cannot accumulate standing by attesting more.
    pub fn reputation(&self, signer: Address) -> u64 {
        self.attestation_count
            .get(&signer)
            .unwrap_or(0)
            .saturating_sub(self.slashes.get(&signer).unwrap_or(0))
    }

    pub fn set_trusted(&mut self, signer: Address, trusted: bool) {
        self.assert_owner();
        self.trusted.set(&signer, trusted);
    }

    /// Owner-only: penalise a signer caught diverging or colluding. Revokes trust and
    /// lowers its standing — the enforcement hook the trusted set answers to today, and
    /// the slot a bonded stake plugs into on the roadmap.
    pub fn slash(&mut self, signer: Address) {
        self.assert_owner();
        self.slashes.add(&signer, 1);
        self.trusted.set(&signer, false);
        self.slashed.set(&signer, true);
        self.env().emit_event(SignerSlashed { signer });
    }

    pub fn set_quorum(&mut self, threshold: u32) {
        self.assert_owner();
        if threshold == 0 {
            self.env().revert(Error::InvalidQuorum);
        }
        self.quorum_threshold.set(threshold);
    }

    /// Owner-only: set the fraud-proof challenge window (block-time ms after quorum during
    /// which anyone may open a challenge). 0 disables challenges.
    pub fn set_challenge_window(&mut self, window: u64) {
        self.assert_owner();
        self.challenge_window.set(window);
    }

    /// Open a bonded fraud-proof challenge against a reached quorum, claiming `counter_hash`
    /// is the correct result. Anyone may call, within the challenge window; the attached CSPR
    /// is the bond. While a challenge is pending, require_quorum is frozen (reverts), so no
    /// consumer can act on a contested output until the owner resolves it.
    #[odra(payable)]
    pub fn challenge(&mut self, request_id: String, counter_hash: String) {
        let winner = match self.quorum_output.get(&request_id) {
            Some(w) => w,
            None => self.env().revert(Error::NoQuorum),
        };
        if self.revoked.get(&request_id).unwrap_or(false) {
            self.env().revert(Error::NoQuorum);
        }
        if self.challenged.get(&request_id).unwrap_or(false) {
            self.env().revert(Error::AlreadyChallenged);
        }
        if counter_hash == winner || counter_hash.contains('#') {
            self.env().revert(Error::InvalidInput);
        }
        let deadline = self.quorum_time.get(&request_id).unwrap_or(0)
            + self.challenge_window.get().unwrap_or(0);
        if self.env().get_block_time() > deadline {
            self.env().revert(Error::ChallengeWindowClosed);
        }
        let challenger = self.env().caller();
        self.challenged.set(&request_id, true);
        self.challenger.set(&request_id, challenger);
        self.counter_hash.set(&request_id, counter_hash.clone());
        let prior = self.challenge_bond.get(&request_id).unwrap_or_default();
        self.challenge_bond.set(&request_id, prior + self.env().attached_value());
        self.env().emit_event(ChallengeOpened { request_id, challenger, counter_hash });
    }

    /// Owner-only: resolve an open challenge. `uphold = true` declares the quorum fraudulent —
    /// every agreeing signer is slashed, the quorum is permanently revoked, and the bond is
    /// returned to the challenger. `uphold = false` rejects it — the quorum stands and the
    /// bond is forfeited to the owner.
    pub fn resolve_challenge(&mut self, request_id: String, uphold: bool) {
        self.assert_owner();
        if !self.challenged.get(&request_id).unwrap_or(false) {
            self.env().revert(Error::NotChallenged);
        }
        let bond = self.challenge_bond.get(&request_id).unwrap_or_default();
        self.challenge_bond.set(&request_id, U512::zero());
        if uphold {
            let winner = self.quorum_output.get(&request_id).unwrap_or_revert(&self.env());
            let pair = (request_id.clone(), winner.clone());
            let count = self.agreement.get(&pair).unwrap_or(0);
            let mut i = 1u32;
            while i <= count {
                if let Some(signer) =
                    self.agree_signers.get(&(request_id.clone(), winner.clone(), i))
                {
                    self.slash(signer);
                }
                i += 1;
            }
            self.revoked.set(&request_id, true);
            let challenger = self.challenger.get(&request_id).unwrap_or_revert(&self.env());
            if bond > U512::zero() {
                self.env().transfer_tokens(&challenger, &bond);
            }
            self.challenged.set(&request_id, false);
            self.env().emit_event(ChallengeUpheld { request_id, revoked_hash: winner });
        } else {
            let owner = self.owner.get().unwrap_or_revert(&self.env());
            if bond > U512::zero() {
                self.env().transfer_tokens(&owner, &bond);
            }
            self.challenged.set(&request_id, false);
            self.env().emit_event(ChallengeRejected { request_id });
        }
    }

    /// Whether a request's quorum has been permanently revoked by an upheld challenge.
    pub fn is_revoked(&self, request_id: String) -> bool {
        self.revoked.get(&request_id).unwrap_or(false)
    }

    /// Hand the owner role to `new_owner`. Owner-only; lets a deployer hand off custody
    /// of the trust-policy key before renouncing.
    pub fn transfer_ownership(&mut self, new_owner: Address) {
        self.assert_owner();
        self.owner.set(new_owner);
    }

    /// Permanently give up the owner role. After this, set_quorum/set_trusted/slash and
    /// ownership changes all revert — freezing the trusted panel as configured. The intended
    /// end state once the quorum and signer set are final: it removes the owner SPOF, so no
    /// single key can later re-curate the panel or forge a quorum.
    pub fn renounce_ownership(&mut self) {
        self.assert_owner();
        self.renounced.set(true);
    }

    pub fn is_renounced(&self) -> bool {
        self.renounced.get().unwrap_or(false)
    }

    fn assert_owner(&self) {
        if self.renounced.get().unwrap_or(false) {
            self.env().revert(Error::NotOwner);
        }
        if self.env().caller() != self.owner.get().unwrap_or_revert(&self.env()) {
            self.env().revert(Error::NotOwner);
        }
    }
}

/// The registry as seen from another contract: a consumer cross-calls these in-VM.
/// `require_quorum` is the guard most contracts use — it reverts unless the output is
/// quorum-attested, so verify-and-act happen atomically and cannot be skipped off-chain.
#[odra::external_contract]
pub trait Registry {
    fn verify(&self, output_hash: String) -> Option<Attestation>;
    fn quorum_of(&self, request_id: String) -> Option<String>;
    fn require_quorum(&self, request_id: String, output_hash: String) -> Address;
    fn reputation(&self, signer: Address) -> u64;
}

#[odra::event]
pub struct PayoutAuthorized {
    pub request_id: String,
    pub output_hash: String,
    pub beneficiary: Address,
    pub signer: Address,
    pub reputation: u64,
}

/// A DeFi consumer behind the action firewall: an example of any contract composing
/// the registry's `require_quorum` guard. Verify-before-act runs inside the Casper VM in
/// one atomic call, so no off-chain agent can skip the check; a poisoned/under-quorum
/// output reverts before a single mote moves.
#[odra::module(events = [PayoutAuthorized])]
pub struct PayoutVault {
    registry: External<RegistryContractRef>,
    // only this address may deposit/release (request_id/output_hash are public in events).
    authorized: Var<Address>,
    // one-shot guard: a request can be released at most once.
    released: Mapping<String, bool>,
    // CSPR held in the vault purse per request, paid to the bound beneficiary on release.
    escrow: Mapping<String, U512>,
    // beneficiary bound on-chain at deposit time (never a free-form release arg).
    beneficiary: Mapping<String, Address>,
    // one-shot guard: escrow refunded to the payer when a request never reaches quorum.
    refunded: Mapping<String, bool>,
}

#[odra::module]
impl PayoutVault {
    pub fn init(&mut self, registry: Address, authorized: Address) {
        self.registry.set(registry);
        self.authorized.set(authorized);
    }

    /// Escrows the attached CSPR for `request_id` and binds the `beneficiary` on-chain.
    /// The value is held in the vault purse until release; binding the beneficiary here
    /// (not at release time) stops any caller from redirecting a verified payout.
    #[odra(payable)]
    pub fn deposit(&mut self, request_id: String, beneficiary: Address) {
        if self.env().caller() != self.authorized.get().unwrap_or_revert(&self.env()) {
            self.env().revert(Error::NotAuthorized);
        }
        let prior = self.escrow.get(&request_id).unwrap_or_default();
        self.escrow.set(&request_id, prior + self.env().attached_value());
        self.beneficiary.set(&request_id, beneficiary);
    }

    /// Releases the escrowed payout for `request_id` to its bound beneficiary. Only the
    /// authorized payer may call, and each request releases at most once. `require_quorum`
    /// reverts in-VM unless `output_hash` is the quorum-attested result, so a poisoned or
    /// under-quorum output reverts before a single mote moves.
    pub fn release(&mut self, request_id: String, output_hash: String) -> u64 {
        if self.env().caller() != self.authorized.get().unwrap_or_revert(&self.env()) {
            self.env().revert(Error::NotAuthorized);
        }
        let signer = self.registry.require_quorum(request_id.clone(), output_hash.clone());
        if self.released.get(&request_id).unwrap_or(false) {
            self.env().revert(Error::AlreadyReleased);
        }
        if self.refunded.get(&request_id).unwrap_or(false) {
            self.env().revert(Error::AlreadyRefunded);
        }
        self.released.set(&request_id, true);
        let beneficiary = self.beneficiary.get(&request_id).unwrap_or_revert(&self.env());
        let amount = self.escrow.get(&request_id).unwrap_or_default();
        if amount > U512::zero() {
            self.env().transfer_tokens(&beneficiary, &amount);
        }
        let reputation = self.registry.reputation(signer);
        self.env().emit_event(PayoutAuthorized {
            request_id,
            output_hash,
            beneficiary,
            signer,
            reputation,
        });
        reputation
    }

    /// Returns the escrowed CSPR for `request_id` to the authorized payer when the request
    /// has not been released. One-shot and mutually exclusive with release: a request is
    /// either paid out (on quorum) or refunded (when quorum never comes) — never both.
    pub fn refund(&mut self, request_id: String) {
        let payer = self.authorized.get().unwrap_or_revert(&self.env());
        if self.env().caller() != payer {
            self.env().revert(Error::NotAuthorized);
        }
        if self.released.get(&request_id).unwrap_or(false) {
            self.env().revert(Error::AlreadyReleased);
        }
        if self.refunded.get(&request_id).unwrap_or(false) {
            self.env().revert(Error::AlreadyRefunded);
        }
        self.refunded.set(&request_id, true);
        let amount = self.escrow.get(&request_id).unwrap_or_default();
        if amount > U512::zero() {
            self.env().transfer_tokens(&payer, &amount);
        }
    }
}

#[odra::event]
pub struct OutcomeSettled {
    pub request_id: String,
    pub outcome_hash: String,
    pub winner: Address,
    pub signer: Address,
}

/// A rival-shaped outcome escrow (the OutcomePay / Escrow402 pattern) made unbypassable by
/// the guard. Stake escrow on a predicted outcome and bind the winner; settle pays the
/// winner ONLY when the outcome is quorum-attested. `settle` cross-calls `require_quorum`
/// first, so a poisoned or under-quorum outcome reverts before a single mote moves — the
/// field's two-step verify-then-settle gap closed in one atomic VM call.
#[odra::module(events = [OutcomeSettled])]
pub struct OutcomeEscrow {
    registry: External<RegistryContractRef>,
    authorized: Var<Address>,
    settled: Mapping<String, bool>,
    refunded: Mapping<String, bool>,
    escrow: Mapping<String, U512>,
    winner: Mapping<String, Address>,
}

#[odra::module]
impl OutcomeEscrow {
    pub fn init(&mut self, registry: Address, authorized: Address) {
        self.registry.set(registry);
        self.authorized.set(authorized);
    }

    /// Escrow the attached CSPR for `request_id` and bind the winner on-chain (never a
    /// free-form settle arg). Authorized-only.
    #[odra(payable)]
    pub fn stake(&mut self, request_id: String, winner: Address) {
        if self.env().caller() != self.authorized.get().unwrap_or_revert(&self.env()) {
            self.env().revert(Error::NotAuthorized);
        }
        let prior = self.escrow.get(&request_id).unwrap_or_default();
        self.escrow.set(&request_id, prior + self.env().attached_value());
        self.winner.set(&request_id, winner);
    }

    /// Settle the escrow to the bound winner — only when `outcome_hash` is the quorum-attested
    /// result for `request_id`. `require_quorum` runs first, so a poisoned/under-quorum outcome
    /// reverts before any transfer. One-shot and mutually exclusive with refund.
    pub fn settle(&mut self, request_id: String, outcome_hash: String) -> Address {
        if self.env().caller() != self.authorized.get().unwrap_or_revert(&self.env()) {
            self.env().revert(Error::NotAuthorized);
        }
        let signer = self.registry.require_quorum(request_id.clone(), outcome_hash.clone());
        if self.settled.get(&request_id).unwrap_or(false) {
            self.env().revert(Error::AlreadyReleased);
        }
        if self.refunded.get(&request_id).unwrap_or(false) {
            self.env().revert(Error::AlreadyRefunded);
        }
        self.settled.set(&request_id, true);
        let winner = self.winner.get(&request_id).unwrap_or_revert(&self.env());
        let amount = self.escrow.get(&request_id).unwrap_or_default();
        if amount > U512::zero() {
            self.env().transfer_tokens(&winner, &amount);
        }
        self.env().emit_event(OutcomeSettled {
            request_id,
            outcome_hash,
            winner,
            signer,
        });
        signer
    }

    /// Return the escrow to the payer when the outcome never reaches quorum. Authorized-only,
    /// one-shot, mutually exclusive with settle (escrow is never both settled and refunded).
    pub fn refund(&mut self, request_id: String) {
        let payer = self.authorized.get().unwrap_or_revert(&self.env());
        if self.env().caller() != payer {
            self.env().revert(Error::NotAuthorized);
        }
        if self.settled.get(&request_id).unwrap_or(false) {
            self.env().revert(Error::AlreadyReleased);
        }
        if self.refunded.get(&request_id).unwrap_or(false) {
            self.env().revert(Error::AlreadyRefunded);
        }
        self.refunded.set(&request_id, true);
        let amount = self.escrow.get(&request_id).unwrap_or_default();
        if amount > U512::zero() {
            self.env().transfer_tokens(&payer, &amount);
        }
    }
}

/// Lowercase hex of bytes (no_std, panic-free).
fn to_hex(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut s = String::with_capacity(bytes.len() * 2);
    for &b in bytes {
        s.push(HEX[(b >> 4) as usize] as char);
        s.push(HEX[(b & 0x0f) as usize] as char);
    }
    s
}

#[odra::event]
pub struct ValuationAccepted {
    pub request_id: String,
    pub asset_id: String,
    pub valuation: U512,
    pub signer: Address,
}

/// Accepts an RWA asset valuation only if it is quorum-attested. The attested output hash
/// canonically binds (asset_id, valuation): `accept` recomputes that commitment on-chain and
/// gates on it, so the quorum provably covers the exact stored pair — a substituted asset or
/// value yields a different hash and reverts. One-shot per request: one proof, one acceptance.
#[odra::module(events = [ValuationAccepted])]
pub struct RWAValuationGate {
    registry: External<RegistryContractRef>,
    authorized: Var<Address>,
    accepted: Mapping<String, bool>,
    valuation: Mapping<String, U512>,
    valuer: Mapping<String, Address>,
}

#[odra::module]
impl RWAValuationGate {
    pub fn init(&mut self, registry: Address, authorized: Address) {
        self.registry.set(registry);
        self.authorized.set(authorized);
    }

    /// The canonical on-chain commitment for a valuation: hex(blake2b(asset_id || valuation)).
    /// Producer agents attest THIS hash, so quorum binds the exact (asset_id, valuation) pair.
    pub fn commitment(&self, asset_id: String, valuation: U512) -> String {
        let value_bytes = match valuation.to_bytes() {
            Ok(b) => b,
            Err(_) => self.env().revert(Error::InvalidInput),
        };
        let mut pre = asset_id.into_bytes();
        pre.extend_from_slice(&value_bytes);
        to_hex(&self.env().hash(pre))
    }

    /// Accept and store `valuation` for `asset_id` only when its commitment is the
    /// quorum-attested result for `request_id`. Authorized-only, one-shot per request.
    pub fn accept(&mut self, request_id: String, asset_id: String, valuation: U512) -> Address {
        if self.env().caller() != self.authorized.get().unwrap_or_revert(&self.env()) {
            self.env().revert(Error::NotAuthorized);
        }
        let valuation_hash = self.commitment(asset_id.clone(), valuation);
        let signer = self.registry.require_quorum(request_id.clone(), valuation_hash);
        if self.accepted.get(&request_id).unwrap_or(false) {
            self.env().revert(Error::AlreadyReleased);
        }
        self.accepted.set(&request_id, true);
        self.valuation.set(&asset_id, valuation);
        self.valuer.set(&asset_id, signer);
        self.env().emit_event(ValuationAccepted {
            request_id,
            asset_id,
            valuation,
            signer,
        });
        signer
    }

    /// The accepted (quorum-passed) valuation for an asset, or None.
    pub fn valuation_of(&self, asset_id: String) -> Option<U512> {
        self.valuation.get(&asset_id)
    }
}

#[odra::event]
pub struct SwapExecuted {
    pub request_id: String,
    pub price_hash: String,
    pub token_in: String,
    pub token_out: String,
    pub amount_in: U512,
    pub min_out: U512,
    pub signer: Address,
}

/// A DeFi action gated on a quorum-attested price feed: the swap executes ONLY when the
/// reference price is the quorum-attested result. `swap` cross-calls require_quorum first, so
/// an unverified or substituted price reverts before the action runs — proving the guard
/// gates a non-payout action, not just payouts (the generic-primitive capstone).
#[odra::module(events = [SwapExecuted])]
pub struct OracleGatedSwap {
    registry: External<RegistryContractRef>,
    authorized: Var<Address>,
    executed: Mapping<String, bool>,
}

#[odra::module]
impl OracleGatedSwap {
    pub fn init(&mut self, registry: Address, authorized: Address) {
        self.registry.set(registry);
        self.authorized.set(authorized);
    }

    /// Execute the swap only when `price_hash` is the quorum-attested feed for `request_id`.
    /// Authorized-only, one-shot per request.
    pub fn swap(
        &mut self,
        request_id: String,
        price_hash: String,
        token_in: String,
        token_out: String,
        amount_in: U512,
        min_out: U512,
    ) -> Address {
        if self.env().caller() != self.authorized.get().unwrap_or_revert(&self.env()) {
            self.env().revert(Error::NotAuthorized);
        }
        let signer = self.registry.require_quorum(request_id.clone(), price_hash.clone());
        if self.executed.get(&request_id).unwrap_or(false) {
            self.env().revert(Error::AlreadyReleased);
        }
        self.executed.set(&request_id, true);
        self.env().emit_event(SwapExecuted {
            request_id,
            price_hash,
            token_in,
            token_out,
            amount_in,
            min_out,
            signer,
        });
        signer
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use odra::host::{Deployer, HostEnv, HostRef, NoArgs};

    fn deploy(env: &HostEnv) -> AttestationRegistryHostRef {
        AttestationRegistry::deploy(env, NoArgs)
    }

    #[test]
    fn single_signer_attest_and_verify() {
        let env = odra_test::env();
        let mut registry = deploy(&env);
        registry.attest("req".into(), "abc123".into(), "claude-opus-4-8".into(), "ph".into());
        let record = registry.verify("abc123".into());
        assert!(record.is_some());
        assert_eq!(record.unwrap().model_id, "claude-opus-4-8");
    }

    #[test]
    fn default_threshold_quorum_is_one() {
        let env = odra_test::env();
        let mut registry = deploy(&env);
        assert_eq!(registry.threshold(), 1);
        registry.attest("r".into(), "h".into(), "m".into(), "p".into());
        assert_eq!(registry.quorum_of("r".into()), Some("h".into()));
    }

    #[test]
    fn verify_unknown_returns_none() {
        let env = odra_test::env();
        let registry = deploy(&env);
        assert!(registry.verify("never".into()).is_none());
        assert!(registry.quorum_of("never".into()).is_none());
    }

    #[test]
    fn owner_is_trusted_by_default() {
        let env = odra_test::env();
        let registry = deploy(&env);
        assert!(registry.is_trusted(env.get_account(0)));
        assert!(!registry.is_trusted(env.get_account(1)));
    }

    #[test]
    fn non_owner_cannot_set_trusted() {
        let env = odra_test::env();
        let mut registry = deploy(&env);
        let attacker = env.get_account(1);
        env.set_caller(attacker);
        assert_eq!(registry.try_set_trusted(attacker, true), Err(Error::NotOwner.into()));
    }

    #[test]
    fn non_owner_cannot_set_quorum() {
        let env = odra_test::env();
        let mut registry = deploy(&env);
        env.set_caller(env.get_account(1));
        assert_eq!(registry.try_set_quorum(2), Err(Error::NotOwner.into()));
    }

    #[test]
    fn set_quorum_rejects_zero() {
        let env = odra_test::env();
        let mut registry = deploy(&env);
        assert_eq!(registry.try_set_quorum(0), Err(Error::InvalidQuorum.into()));
    }

    #[test]
    fn untrusted_signer_cannot_attest() {
        let env = odra_test::env();
        let mut registry = deploy(&env);
        env.set_caller(env.get_account(1));
        assert_eq!(
            registry.try_attest("r".into(), "h".into(), "m".into(), "p".into()),
            Err(Error::NotTrusted.into())
        );
    }

    #[test]
    fn duplicate_signer_vote_reverts() {
        let env = odra_test::env();
        let mut registry = deploy(&env);
        registry.attest("r".into(), "h".into(), "m".into(), "p".into());
        assert_eq!(
            registry.try_attest("r".into(), "h".into(), "m".into(), "p".into()),
            Err(Error::AlreadyVoted.into())
        );
    }

    #[test]
    fn a_signer_cannot_vote_twice_even_for_a_different_output() {
        let env = odra_test::env();
        let mut registry = deploy(&env);
        registry.attest("r".into(), "h1".into(), "m".into(), "p".into());
        assert_eq!(
            registry.try_attest("r".into(), "h2".into(), "m".into(), "p".into()),
            Err(Error::AlreadyVoted.into())
        );
    }

    #[test]
    fn reputation_counts_a_signers_attestations() {
        let env = odra_test::env();
        let mut registry = deploy(&env);
        let owner = env.get_account(0);
        assert_eq!(registry.reputation(owner), 0);
        registry.attest("a".into(), "x".into(), "m".into(), "p".into());
        registry.attest("b".into(), "y".into(), "m".into(), "p".into());
        assert_eq!(registry.reputation(owner), 2);
    }

    #[test]
    fn slash_lowers_standing_and_revokes_trust() {
        let env = odra_test::env();
        let mut registry = deploy(&env);
        let s2 = env.get_account(1);
        registry.set_trusted(s2, true);
        env.set_caller(s2);
        registry.attest("r1".into(), "x".into(), "m".into(), "p".into());
        registry.attest("r2".into(), "y".into(), "m".into(), "p".into());

        env.set_caller(env.get_account(0));
        assert_eq!(registry.reputation(s2), 2);
        registry.slash(s2);
        assert_eq!(registry.reputation(s2), 1);
        assert!(!registry.is_trusted(s2));

        env.set_caller(s2);
        assert_eq!(
            registry.try_attest("r3".into(), "z".into(), "m".into(), "p".into()),
            Err(Error::NotTrusted.into())
        );
    }

    #[test]
    fn non_owner_cannot_slash() {
        let env = odra_test::env();
        let mut registry = deploy(&env);
        env.set_caller(env.get_account(1));
        assert_eq!(registry.try_slash(env.get_account(1)), Err(Error::NotOwner.into()));
    }

    #[test]
    fn require_quorum_returns_signer_when_met_else_reverts() {
        let env = odra_test::env();
        let mut registry = deploy(&env);
        assert_eq!(
            registry.try_require_quorum("r".into(), "h".into()),
            Err(Error::NoQuorum.into())
        );
        registry.attest("r".into(), "h".into(), "m".into(), "p".into());
        assert_eq!(registry.require_quorum("r".into(), "h".into()), env.get_account(0));
        assert_eq!(
            registry.try_require_quorum("r".into(), "poisoned".into()),
            Err(Error::NoQuorum.into())
        );
    }

    #[test]
    fn quorum_reached_when_k_distinct_signers_agree() {
        let env = odra_test::env();
        let mut registry = deploy(&env);
        registry.set_quorum(3);
        let s2 = env.get_account(1);
        let s3 = env.get_account(2);
        registry.set_trusted(s2, true);
        registry.set_trusted(s3, true);

        registry.attest("req".into(), "H".into(), "model-a".into(), "p".into());
        assert!(registry.quorum_of("req".into()).is_none());
        env.set_caller(s2);
        registry.attest("req".into(), "H".into(), "model-b".into(), "p".into());
        assert!(registry.quorum_of("req".into()).is_none());
        env.set_caller(s3);
        registry.attest("req".into(), "H".into(), "model-c".into(), "p".into());

        assert_eq!(registry.quorum_of("req".into()), Some("H".into()));
        assert_eq!(registry.agreement_count("req".into(), "H".into()), 3);
    }

    #[test]
    fn no_quorum_when_one_model_dissents() {
        let env = odra_test::env();
        let mut registry = deploy(&env);
        registry.set_quorum(3);
        let s2 = env.get_account(1);
        let s3 = env.get_account(2);
        registry.set_trusted(s2, true);
        registry.set_trusted(s3, true);

        registry.attest("req".into(), "good".into(), "a".into(), "p".into());
        env.set_caller(s2);
        registry.attest("req".into(), "good".into(), "b".into(), "p".into());
        env.set_caller(s3);
        registry.attest("req".into(), "TAMPERED".into(), "c".into(), "p".into());

        assert!(registry.quorum_of("req".into()).is_none());
        assert_eq!(registry.agreement_count("req".into(), "good".into()), 2);
        assert_eq!(registry.agreement_count("req".into(), "TAMPERED".into()), 1);
    }

    #[test]
    fn c1_collision_framings_cannot_forge_quorum() {
        // C1: one trusted signer must not forge a k-of-n quorum by exploiting an ambiguous
        // "{request_id}#{output_hash}" key. These three framings collapsed into one counter
        // under the old key (each has a distinct request_id, so the per-request `voted` guard
        // let them through). Now the '#' boundary is rejected and the tally is keyed by the
        // structured (request_id, output_hash) tuple — assert each framing records nothing.
        let env = odra_test::env();
        let mut registry = deploy(&env);
        registry.set_quorum(3);
        assert_eq!(
            registry.try_attest("x".into(), "x#x#x".into(), "m".into(), "p".into()),
            Err(Error::InvalidInput.into())
        );
        assert_eq!(
            registry.try_attest("x#x".into(), "x#x".into(), "m".into(), "p".into()),
            Err(Error::InvalidInput.into())
        );
        assert_eq!(
            registry.try_attest("x#x#x".into(), "x".into(), "m".into(), "p".into()),
            Err(Error::InvalidInput.into())
        );
        assert_eq!(registry.agreement_count("x".into(), "x#x#x".into()), 0);
        assert_eq!(registry.agreement_count("x#x".into(), "x#x".into()), 0);
        assert_eq!(registry.agreement_count("x#x#x".into(), "x".into()), 0);
        assert!(registry.quorum_of("x#x#x".into()).is_none());
        assert_eq!(
            registry.try_require_quorum("x#x#x".into(), "x".into()),
            Err(Error::NoQuorum.into())
        );
    }

    #[test]
    fn c1_attest_rejects_separator_in_inputs() {
        let env = odra_test::env();
        let mut registry = deploy(&env);
        assert_eq!(
            registry.try_attest("a#b".into(), "h".into(), "m".into(), "p".into()),
            Err(Error::InvalidInput.into())
        );
        assert_eq!(
            registry.try_attest("r".into(), "h#h".into(), "m".into(), "p".into()),
            Err(Error::InvalidInput.into())
        );
    }

    fn deploy_pair(env: &HostEnv) -> (AttestationRegistryHostRef, PayoutVaultHostRef) {
        let registry = AttestationRegistry::deploy(env, NoArgs);
        let vault = PayoutVault::deploy(
            env,
            PayoutVaultInitArgs { registry: registry.address(), authorized: env.get_account(0) },
        );
        (registry, vault)
    }

    #[test]
    fn vault_authorizes_release_when_quorum_met() {
        let env = odra_test::env();
        let (mut registry, mut vault) = deploy_pair(&env);
        registry.set_quorum(2);
        let s2 = env.get_account(1);
        registry.set_trusted(s2, true);

        let beneficiary = env.get_account(3);
        vault.with_tokens(U512::from(1_000_000_000u64)).deposit("req".into(), beneficiary);

        registry.attest("req".into(), "h".into(), "model-a".into(), "p".into());
        env.set_caller(s2);
        registry.attest("req".into(), "h".into(), "model-b".into(), "p".into());

        env.set_caller(env.get_account(0));
        let reputation = vault.release("req".into(), "h".into());
        assert_eq!(reputation, 1);
    }

    #[test]
    fn vault_reverts_without_quorum() {
        let env = odra_test::env();
        let (mut registry, mut vault) = deploy_pair(&env);
        registry.set_quorum(2);
        registry.attest("req".into(), "h".into(), "m".into(), "p".into());
        assert_eq!(
            vault.try_release("req".into(), "h".into()),
            Err(Error::NoQuorum.into())
        );
    }

    #[test]
    fn vault_blocks_a_poisoned_output_even_after_quorum() {
        let env = odra_test::env();
        let (mut registry, mut vault) = deploy_pair(&env);
        registry.set_quorum(2);
        let s2 = env.get_account(1);
        registry.set_trusted(s2, true);

        let beneficiary = env.get_account(3);
        vault.with_tokens(U512::from(1_000_000_000u64)).deposit("req".into(), beneficiary);

        registry.attest("req".into(), "genuine".into(), "a".into(), "p".into());
        env.set_caller(s2);
        registry.attest("req".into(), "genuine".into(), "b".into(), "p".into());

        env.set_caller(env.get_account(0));
        assert_eq!(
            vault.try_release("req".into(), "poisoned".into()),
            Err(Error::NoQuorum.into())
        );
        assert!(vault.try_release("req".into(), "genuine".into()).is_ok());
    }

    #[test]
    fn c2_slashing_revokes_a_reached_quorum() {
        // C2: quorum_output is write-once, but the gate must reflect LIVE trust.
        // Two signers reach quorum, then both are slashed — require_quorum (and the
        // vault release that composes it) must now revert, not pass forever.
        let env = odra_test::env();
        let (mut registry, mut vault) = deploy_pair(&env);
        registry.set_quorum(2);
        let s2 = env.get_account(1);
        let s3 = env.get_account(2);
        registry.set_trusted(s2, true);
        registry.set_trusted(s3, true);

        env.set_caller(s2);
        registry.attest("req".into(), "h".into(), "a".into(), "p".into());
        env.set_caller(s3);
        registry.attest("req".into(), "h".into(), "b".into(), "p".into());

        env.set_caller(env.get_account(0));
        assert_eq!(registry.quorum_of("req".into()), Some("h".into()));
        // gate passes while both signers are trusted, and returns a still-trusted lead
        assert_eq!(registry.require_quorum("req".into(), "h".into()), s2);

        registry.slash(s2);
        registry.slash(s3);

        assert_eq!(
            registry.try_require_quorum("req".into(), "h".into()),
            Err(Error::NoQuorum.into())
        );
        assert_eq!(
            vault.try_release("req".into(), "h".into()),
            Err(Error::NoQuorum.into())
        );
    }

    #[test]
    fn h1_unauthorized_caller_cannot_release() {
        // H1: request_id/output_hash are public (events), so only the authorized payer
        // may call release — a stranger must not authorize a payout to themselves.
        let env = odra_test::env();
        let (mut registry, mut vault) = deploy_pair(&env);
        registry.set_quorum(2);
        let s2 = env.get_account(1);
        registry.set_trusted(s2, true);
        registry.attest("req".into(), "h".into(), "a".into(), "p".into());
        env.set_caller(s2);
        registry.attest("req".into(), "h".into(), "b".into(), "p".into());

        let attacker = env.get_account(5);
        env.set_caller(attacker);
        assert_eq!(
            vault.try_release("req".into(), "h".into()),
            Err(Error::NotAuthorized.into())
        );
    }

    #[test]
    fn h1_release_is_one_shot() {
        // H1: a request releases at most once — no replay of the same authorized payout.
        let env = odra_test::env();
        let (mut registry, mut vault) = deploy_pair(&env);
        registry.set_quorum(2);
        let s2 = env.get_account(1);
        registry.set_trusted(s2, true);
        let beneficiary = env.get_account(3);
        vault.with_tokens(U512::from(1_000_000_000u64)).deposit("req".into(), beneficiary);
        registry.attest("req".into(), "h".into(), "a".into(), "p".into());
        env.set_caller(s2);
        registry.attest("req".into(), "h".into(), "b".into(), "p".into());

        env.set_caller(env.get_account(0));
        assert!(vault.try_release("req".into(), "h".into()).is_ok());
        assert_eq!(
            vault.try_release("req".into(), "h".into()),
            Err(Error::AlreadyReleased.into())
        );
    }

    #[test]
    fn m2_release_moves_escrowed_funds_only_on_quorum() {
        // M2: the vault holds a real purse. A poisoned/under-quorum release reverts before
        // any mote moves; a quorum-attested release transfers exactly the escrowed amount.
        let env = odra_test::env();
        let (mut registry, mut vault) = deploy_pair(&env);
        registry.set_quorum(2);
        let s2 = env.get_account(1);
        registry.set_trusted(s2, true);

        let beneficiary = env.get_account(3);
        let amount = U512::from(2_000_000_000u64);
        vault.with_tokens(amount).deposit("req".into(), beneficiary);
        let before = env.balance_of(&beneficiary);

        // one of two signers — no quorum: release reverts and moves nothing
        registry.attest("req".into(), "genuine".into(), "a".into(), "p".into());
        env.set_caller(env.get_account(0));
        assert_eq!(
            vault.try_release("req".into(), "genuine".into()),
            Err(Error::NoQuorum.into())
        );
        assert_eq!(env.balance_of(&beneficiary), before);

        // quorum reached — release transfers exactly the escrowed amount
        env.set_caller(s2);
        registry.attest("req".into(), "genuine".into(), "b".into(), "p".into());
        env.set_caller(env.get_account(0));
        assert!(vault.try_release("req".into(), "genuine".into()).is_ok());
        assert_eq!(env.balance_of(&beneficiary), before + amount);
    }

    #[test]
    fn m1_lowering_threshold_cannot_seal_an_inflight_request() {
        // M1: the threshold a request was opened under is snapshotted at first attestation,
        // so a later set_quorum cannot retroactively seal an under-quorum in-flight request.
        let env = odra_test::env();
        let mut registry = deploy(&env);
        registry.set_quorum(3);
        let s2 = env.get_account(1);
        registry.set_trusted(s2, true);

        // request opened under threshold 3; one signer attests "bad"
        registry.attest("req".into(), "bad".into(), "a".into(), "p".into());
        assert!(registry.quorum_of("req".into()).is_none());

        // owner lowers the live threshold mid-flight
        registry.set_quorum(2);

        // a second signer attests the same hash → agreed=2. Under the lowered LIVE threshold
        // this would seal (2 >= 2); under the per-request snapshot (3) it must NOT.
        env.set_caller(s2);
        registry.attest("req".into(), "bad".into(), "b".into(), "p".into());
        assert!(registry.quorum_of("req".into()).is_none());

        // a NEW request opened after the lowering legitimately seals at the new threshold (2)
        env.set_caller(env.get_account(0));
        registry.attest("req2".into(), "g".into(), "a".into(), "p".into());
        env.set_caller(s2);
        registry.attest("req2".into(), "g".into(), "b".into(), "p".into());
        assert_eq!(registry.quorum_of("req2".into()), Some("g".into()));
    }

    #[test]
    fn slash_is_sticky_retrust_cannot_revive_quorum() {
        // Slashing must be permanent for the gate: re-trusting a slashed signer must NOT
        // revive a quorum it backed. A slashed address never counts toward the live
        // still-trusted re-count, even if set_trusted re-flips its trust flag.
        let env = odra_test::env();
        let mut registry = deploy(&env);
        registry.set_quorum(2);
        let s2 = env.get_account(1);
        let s3 = env.get_account(2);
        registry.set_trusted(s2, true);
        registry.set_trusted(s3, true);
        env.set_caller(s2);
        registry.attest("req".into(), "h".into(), "a".into(), "p".into());
        env.set_caller(s3);
        registry.attest("req".into(), "h".into(), "b".into(), "p".into());

        env.set_caller(env.get_account(0));
        assert_eq!(registry.require_quorum("req".into(), "h".into()), s2);
        registry.slash(s2);
        registry.slash(s3);
        assert_eq!(
            registry.try_require_quorum("req".into(), "h".into()),
            Err(Error::NoQuorum.into())
        );

        // owner re-trusts the slashed signers — the gate must STILL revert
        registry.set_trusted(s2, true);
        registry.set_trusted(s3, true);
        assert_eq!(
            registry.try_require_quorum("req".into(), "h".into()),
            Err(Error::NoQuorum.into())
        );
    }

    #[test]
    fn refund_returns_escrow_when_quorum_never_reached() {
        // Fund-safety: escrow on a request that never reaches quorum is recoverable.
        let env = odra_test::env();
        let (mut registry, mut vault) = deploy_pair(&env);
        registry.set_quorum(2);
        let s2 = env.get_account(1);
        registry.set_trusted(s2, true);
        let beneficiary = env.get_account(3);
        let payer = env.get_account(0);
        let amount = U512::from(2_000_000_000u64);
        let payer_before = env.balance_of(&payer);

        vault.with_tokens(amount).deposit("req".into(), beneficiary);
        assert_eq!(env.balance_of(&payer), payer_before - amount);

        // only one of two signers attests — never reaches quorum; release reverts
        registry.attest("req".into(), "h".into(), "a".into(), "p".into());
        env.set_caller(payer);
        assert_eq!(vault.try_release("req".into(), "h".into()), Err(Error::NoQuorum.into()));

        // payer reclaims the stranded escrow, and cannot refund twice
        vault.refund("req".into());
        assert_eq!(env.balance_of(&payer), payer_before);
        assert_eq!(vault.try_refund("req".into()), Err(Error::AlreadyRefunded.into()));
    }

    #[test]
    fn released_request_cannot_be_refunded() {
        // Mutual exclusion: a paid-out request can never be refunded (no double spend).
        let env = odra_test::env();
        let (mut registry, mut vault) = deploy_pair(&env);
        registry.set_quorum(2);
        let s2 = env.get_account(1);
        registry.set_trusted(s2, true);
        let beneficiary = env.get_account(3);
        vault.with_tokens(U512::from(1_000_000_000u64)).deposit("req".into(), beneficiary);
        registry.attest("req".into(), "h".into(), "a".into(), "p".into());
        env.set_caller(s2);
        registry.attest("req".into(), "h".into(), "b".into(), "p".into());

        env.set_caller(env.get_account(0));
        assert!(vault.try_release("req".into(), "h".into()).is_ok());
        assert_eq!(vault.try_refund("req".into()), Err(Error::AlreadyReleased.into()));
    }

    #[test]
    fn ownership_transfer_and_renounce() {
        // Owner SPOF teeth: ownership can be handed off, and renounced to freeze the panel.
        let env = odra_test::env();
        let mut registry = deploy(&env);
        let new_owner = env.get_account(1);

        // a non-owner cannot transfer ownership
        env.set_caller(new_owner);
        assert_eq!(registry.try_transfer_ownership(new_owner), Err(Error::NotOwner.into()));

        // owner hands off; the old owner loses powers, the new owner gains them
        env.set_caller(env.get_account(0));
        registry.transfer_ownership(new_owner);
        assert_eq!(registry.try_set_quorum(3), Err(Error::NotOwner.into()));
        env.set_caller(new_owner);
        registry.set_quorum(3);
        assert_eq!(registry.threshold(), 3);

        // renounce freezes the configuration — no one can change it afterward
        assert!(!registry.is_renounced());
        registry.renounce_ownership();
        assert!(registry.is_renounced());
        assert_eq!(registry.try_set_quorum(2), Err(Error::NotOwner.into()));
        assert_eq!(registry.try_set_trusted(new_owner, false), Err(Error::NotOwner.into()));
        assert_eq!(registry.try_slash(new_owner), Err(Error::NotOwner.into()));
        assert_eq!(
            registry.try_transfer_ownership(env.get_account(0)),
            Err(Error::NotOwner.into())
        );
    }

    fn deploy_escrow(env: &HostEnv) -> (AttestationRegistryHostRef, OutcomeEscrowHostRef) {
        let registry = AttestationRegistry::deploy(env, NoArgs);
        let escrow = OutcomeEscrow::deploy(
            env,
            OutcomeEscrowInitArgs { registry: registry.address(), authorized: env.get_account(0) },
        );
        (registry, escrow)
    }

    #[test]
    fn settle_pays_winner_on_quorum() {
        let env = odra_test::env();
        let (mut registry, mut escrow) = deploy_escrow(&env);
        registry.set_quorum(2);
        let s2 = env.get_account(1);
        registry.set_trusted(s2, true);
        let winner = env.get_account(3);
        let amount = U512::from(2_000_000_000u64);
        escrow.with_tokens(amount).stake("req".into(), winner);
        let before = env.balance_of(&winner);
        registry.attest("req".into(), "o".into(), "a".into(), "p".into());
        env.set_caller(s2);
        registry.attest("req".into(), "o".into(), "b".into(), "p".into());
        env.set_caller(env.get_account(0));
        assert_eq!(escrow.settle("req".into(), "o".into()), env.get_account(0));
        assert_eq!(env.balance_of(&winner), before + amount);
    }

    #[test]
    fn settle_reverts_without_quorum() {
        // The kill move: the rival outcome-escrow pattern cannot pay on an unverified outcome.
        let env = odra_test::env();
        let (mut registry, mut escrow) = deploy_escrow(&env);
        registry.set_quorum(2);
        let winner = env.get_account(3);
        let amount = U512::from(2_000_000_000u64);
        escrow.with_tokens(amount).stake("req".into(), winner);
        let before = env.balance_of(&winner);
        registry.attest("req".into(), "o".into(), "a".into(), "p".into());
        env.set_caller(env.get_account(0));
        assert_eq!(escrow.try_settle("req".into(), "o".into()), Err(Error::NoQuorum.into()));
        assert_eq!(env.balance_of(&winner), before);
    }

    #[test]
    fn settle_blocked_after_slash() {
        let env = odra_test::env();
        let (mut registry, mut escrow) = deploy_escrow(&env);
        registry.set_quorum(2);
        let s2 = env.get_account(1);
        let s3 = env.get_account(2);
        registry.set_trusted(s2, true);
        registry.set_trusted(s3, true);
        let winner = env.get_account(4);
        escrow.with_tokens(U512::from(1_000_000_000u64)).stake("req".into(), winner);
        env.set_caller(s2);
        registry.attest("req".into(), "o".into(), "a".into(), "p".into());
        env.set_caller(s3);
        registry.attest("req".into(), "o".into(), "b".into(), "p".into());
        env.set_caller(env.get_account(0));
        registry.slash(s2);
        registry.slash(s3);
        assert_eq!(escrow.try_settle("req".into(), "o".into()), Err(Error::NoQuorum.into()));
    }

    #[test]
    fn unauthorized_caller_cannot_settle() {
        let env = odra_test::env();
        let (mut registry, mut escrow) = deploy_escrow(&env);
        registry.set_quorum(2);
        let s2 = env.get_account(1);
        registry.set_trusted(s2, true);
        registry.attest("req".into(), "o".into(), "a".into(), "p".into());
        env.set_caller(s2);
        registry.attest("req".into(), "o".into(), "b".into(), "p".into());
        env.set_caller(env.get_account(5));
        assert_eq!(escrow.try_settle("req".into(), "o".into()), Err(Error::NotAuthorized.into()));
    }

    #[test]
    fn settle_is_one_shot() {
        let env = odra_test::env();
        let (mut registry, mut escrow) = deploy_escrow(&env);
        registry.set_quorum(2);
        let s2 = env.get_account(1);
        registry.set_trusted(s2, true);
        let winner = env.get_account(3);
        escrow.with_tokens(U512::from(1_000_000_000u64)).stake("req".into(), winner);
        registry.attest("req".into(), "o".into(), "a".into(), "p".into());
        env.set_caller(s2);
        registry.attest("req".into(), "o".into(), "b".into(), "p".into());
        env.set_caller(env.get_account(0));
        assert!(escrow.try_settle("req".into(), "o".into()).is_ok());
        assert_eq!(escrow.try_settle("req".into(), "o".into()), Err(Error::AlreadyReleased.into()));
    }

    #[test]
    fn escrow_refund_returns_stake_when_no_quorum() {
        let env = odra_test::env();
        let (mut registry, mut escrow) = deploy_escrow(&env);
        registry.set_quorum(2);
        let winner = env.get_account(3);
        let payer = env.get_account(0);
        let amount = U512::from(2_000_000_000u64);
        let payer_before = env.balance_of(&payer);
        escrow.with_tokens(amount).stake("req".into(), winner);
        assert_eq!(env.balance_of(&payer), payer_before - amount);
        registry.attest("req".into(), "o".into(), "a".into(), "p".into());
        env.set_caller(payer);
        assert_eq!(escrow.try_settle("req".into(), "o".into()), Err(Error::NoQuorum.into()));
        escrow.refund("req".into());
        assert_eq!(env.balance_of(&payer), payer_before);
        assert_eq!(escrow.try_refund("req".into()), Err(Error::AlreadyRefunded.into()));
    }

    #[test]
    fn settled_request_cannot_be_refunded() {
        let env = odra_test::env();
        let (mut registry, mut escrow) = deploy_escrow(&env);
        registry.set_quorum(2);
        let s2 = env.get_account(1);
        registry.set_trusted(s2, true);
        let winner = env.get_account(3);
        escrow.with_tokens(U512::from(1_000_000_000u64)).stake("req".into(), winner);
        registry.attest("req".into(), "o".into(), "a".into(), "p".into());
        env.set_caller(s2);
        registry.attest("req".into(), "o".into(), "b".into(), "p".into());
        env.set_caller(env.get_account(0));
        assert!(escrow.try_settle("req".into(), "o".into()).is_ok());
        assert_eq!(escrow.try_refund("req".into()), Err(Error::AlreadyReleased.into()));
    }

    fn deploy_rwa(env: &HostEnv) -> (AttestationRegistryHostRef, RWAValuationGateHostRef) {
        let registry = AttestationRegistry::deploy(env, NoArgs);
        let gate = RWAValuationGate::deploy(
            env,
            RWAValuationGateInitArgs { registry: registry.address(), authorized: env.get_account(0) },
        );
        (registry, gate)
    }

    // Two trusted signers attest the gate's canonical commitment of (asset, valuation),
    // leaving the caller as the authorized account (0).
    fn attest_valuation(
        env: &HostEnv,
        registry: &mut AttestationRegistryHostRef,
        gate: &RWAValuationGateHostRef,
        s2: Address,
        req: &str,
        asset: &str,
        valuation: U512,
    ) {
        let vh = gate.commitment(asset.into(), valuation);
        env.set_caller(env.get_account(0));
        registry.attest(req.into(), vh.clone(), "a".into(), "p".into());
        env.set_caller(s2);
        registry.attest(req.into(), vh, "b".into(), "p".into());
        env.set_caller(env.get_account(0));
    }

    #[test]
    fn valuation_accepted_on_quorum() {
        let env = odra_test::env();
        let (mut registry, mut gate) = deploy_rwa(&env);
        registry.set_quorum(2);
        let s2 = env.get_account(1);
        registry.set_trusted(s2, true);
        let v = U512::from(1_278_000u64);
        attest_valuation(&env, &mut registry, &gate, s2, "req", "PARK-NOTE-001", v);
        assert_eq!(gate.accept("req".into(), "PARK-NOTE-001".into(), v), env.get_account(0));
        assert_eq!(gate.valuation_of("PARK-NOTE-001".into()), Some(v));
    }

    #[test]
    fn accept_reverts_without_quorum() {
        let env = odra_test::env();
        let (mut registry, mut gate) = deploy_rwa(&env);
        registry.set_quorum(2);
        let v = U512::from(1u64);
        let vh = gate.commitment("A1".into(), v);
        registry.attest("req".into(), vh, "a".into(), "p".into());
        env.set_caller(env.get_account(0));
        assert_eq!(
            gate.try_accept("req".into(), "A1".into(), v),
            Err(Error::NoQuorum.into())
        );
        assert_eq!(gate.valuation_of("A1".into()), None);
    }

    #[test]
    fn accept_blocked_after_slash() {
        let env = odra_test::env();
        let (mut registry, mut gate) = deploy_rwa(&env);
        registry.set_quorum(2);
        let s2 = env.get_account(1);
        let s3 = env.get_account(2);
        registry.set_trusted(s2, true);
        registry.set_trusted(s3, true);
        let v = U512::from(5u64);
        let vh = gate.commitment("A1".into(), v);
        env.set_caller(s2);
        registry.attest("req".into(), vh.clone(), "a".into(), "p".into());
        env.set_caller(s3);
        registry.attest("req".into(), vh, "b".into(), "p".into());
        env.set_caller(env.get_account(0));
        registry.slash(s2);
        registry.slash(s3);
        assert_eq!(
            gate.try_accept("req".into(), "A1".into(), v),
            Err(Error::NoQuorum.into())
        );
        assert_eq!(gate.valuation_of("A1".into()), None);
    }

    #[test]
    fn unauthorized_caller_cannot_accept() {
        let env = odra_test::env();
        let (mut registry, mut gate) = deploy_rwa(&env);
        registry.set_quorum(2);
        let s2 = env.get_account(1);
        registry.set_trusted(s2, true);
        let v = U512::from(7u64);
        attest_valuation(&env, &mut registry, &gate, s2, "req", "A1", v);
        env.set_caller(env.get_account(5));
        assert_eq!(
            gate.try_accept("req".into(), "A1".into(), v),
            Err(Error::NotAuthorized.into())
        );
    }

    #[test]
    fn accept_is_one_shot() {
        let env = odra_test::env();
        let (mut registry, mut gate) = deploy_rwa(&env);
        registry.set_quorum(2);
        let s2 = env.get_account(1);
        registry.set_trusted(s2, true);
        let v = U512::from(100u64);
        attest_valuation(&env, &mut registry, &gate, s2, "req", "A1", v);
        assert!(gate.try_accept("req".into(), "A1".into(), v).is_ok());
        assert_eq!(
            gate.try_accept("req".into(), "A1".into(), v),
            Err(Error::AlreadyReleased.into())
        );
        assert_eq!(gate.valuation_of("A1".into()), Some(v));
    }

    #[test]
    fn one_quorum_proof_cannot_stamp_a_different_asset_or_value() {
        // The audit-blocking bypass, now closed: a quorum on (asset A, value v) cannot be
        // reused to stamp a different asset or a substituted value — the on-chain commitment
        // differs, so require_quorum reverts.
        let env = odra_test::env();
        let (mut registry, mut gate) = deploy_rwa(&env);
        registry.set_quorum(2);
        let s2 = env.get_account(1);
        registry.set_trusted(s2, true);
        let v = U512::from(1_000u64);
        attest_valuation(&env, &mut registry, &gate, s2, "req", "ASSET-A", v);
        // substituted value for the same asset -> different commitment -> NoQuorum
        assert_eq!(
            gate.try_accept("req".into(), "ASSET-A".into(), U512::from(999_999u64)),
            Err(Error::NoQuorum.into())
        );
        // different asset reusing the same proof -> different commitment -> NoQuorum
        assert_eq!(
            gate.try_accept("req".into(), "ASSET-B".into(), v),
            Err(Error::NoQuorum.into())
        );
        assert_eq!(gate.valuation_of("ASSET-B".into()), None);
        // the honestly-attested pair still accepts
        assert!(gate.try_accept("req".into(), "ASSET-A".into(), v).is_ok());
    }

    fn deploy_swap(env: &HostEnv) -> (AttestationRegistryHostRef, OracleGatedSwapHostRef) {
        let registry = AttestationRegistry::deploy(env, NoArgs);
        let swap = OracleGatedSwap::deploy(
            env,
            OracleGatedSwapInitArgs { registry: registry.address(), authorized: env.get_account(0) },
        );
        (registry, swap)
    }

    #[test]
    fn swap_executes_when_price_quorum_met() {
        let env = odra_test::env();
        let (mut registry, mut swap) = deploy_swap(&env);
        registry.set_quorum(2);
        let s2 = env.get_account(1);
        registry.set_trusted(s2, true);
        registry.attest("req".into(), "ph".into(), "a".into(), "p".into());
        env.set_caller(s2);
        registry.attest("req".into(), "ph".into(), "b".into(), "p".into());
        env.set_caller(env.get_account(0));
        assert_eq!(
            swap.swap("req".into(), "ph".into(), "USDC".into(), "CSPR".into(), U512::from(1000u64), U512::from(900u64)),
            env.get_account(0)
        );
    }

    #[test]
    fn swap_reverts_without_quorum() {
        let env = odra_test::env();
        let (mut registry, mut swap) = deploy_swap(&env);
        registry.set_quorum(2);
        let s2 = env.get_account(1);
        registry.set_trusted(s2, true);
        registry.attest("req".into(), "ph".into(), "a".into(), "p".into());
        env.set_caller(env.get_account(0));
        assert_eq!(
            swap.try_swap("req".into(), "ph".into(), "USDC".into(), "CSPR".into(), U512::from(1000u64), U512::from(900u64)),
            Err(Error::NoQuorum.into())
        );
        // even after quorum is reached, a SUBSTITUTED price hash reverts
        env.set_caller(s2);
        registry.attest("req".into(), "ph".into(), "b".into(), "p".into());
        env.set_caller(env.get_account(0));
        assert_eq!(
            swap.try_swap("req".into(), "SUBST".into(), "USDC".into(), "CSPR".into(), U512::from(1000u64), U512::from(900u64)),
            Err(Error::NoQuorum.into())
        );
    }

    #[test]
    fn swap_blocked_after_signers_slashed() {
        let env = odra_test::env();
        let (mut registry, mut swap) = deploy_swap(&env);
        registry.set_quorum(2);
        let s2 = env.get_account(1);
        let s3 = env.get_account(2);
        registry.set_trusted(s2, true);
        registry.set_trusted(s3, true);
        env.set_caller(s2);
        registry.attest("req".into(), "ph".into(), "a".into(), "p".into());
        env.set_caller(s3);
        registry.attest("req".into(), "ph".into(), "b".into(), "p".into());
        env.set_caller(env.get_account(0));
        registry.slash(s2);
        registry.slash(s3);
        assert_eq!(
            swap.try_swap("req".into(), "ph".into(), "USDC".into(), "CSPR".into(), U512::from(1000u64), U512::from(900u64)),
            Err(Error::NoQuorum.into())
        );
    }

    #[test]
    fn unauthorized_caller_cannot_swap() {
        let env = odra_test::env();
        let (mut registry, mut swap) = deploy_swap(&env);
        registry.set_quorum(2);
        let s2 = env.get_account(1);
        registry.set_trusted(s2, true);
        registry.attest("req".into(), "ph".into(), "a".into(), "p".into());
        env.set_caller(s2);
        registry.attest("req".into(), "ph".into(), "b".into(), "p".into());
        env.set_caller(env.get_account(5));
        assert_eq!(
            swap.try_swap("req".into(), "ph".into(), "USDC".into(), "CSPR".into(), U512::from(1000u64), U512::from(900u64)),
            Err(Error::NotAuthorized.into())
        );
    }

    #[test]
    fn swap_is_one_shot() {
        let env = odra_test::env();
        let (mut registry, mut swap) = deploy_swap(&env);
        registry.set_quorum(2);
        let s2 = env.get_account(1);
        registry.set_trusted(s2, true);
        registry.attest("req".into(), "ph".into(), "a".into(), "p".into());
        env.set_caller(s2);
        registry.attest("req".into(), "ph".into(), "b".into(), "p".into());
        env.set_caller(env.get_account(0));
        assert!(swap.try_swap("req".into(), "ph".into(), "USDC".into(), "CSPR".into(), U512::from(1000u64), U512::from(900u64)).is_ok());
        assert_eq!(
            swap.try_swap("req".into(), "ph".into(), "USDC".into(), "CSPR".into(), U512::from(1000u64), U512::from(900u64)),
            Err(Error::AlreadyReleased.into())
        );
    }

    // Deploy a registry with k=2, a challenge window, and quorum reached on ("req","h") by
    // the owner (account 0) + s2. Leaves the caller as the owner.
    fn registry_with_quorum(env: &HostEnv, window: u64) -> (AttestationRegistryHostRef, Address) {
        let mut registry = deploy(env);
        registry.set_quorum(2);
        registry.set_challenge_window(window);
        let s2 = env.get_account(1);
        registry.set_trusted(s2, true);
        registry.attest("req".into(), "h".into(), "a".into(), "p".into());
        env.set_caller(s2);
        registry.attest("req".into(), "h".into(), "b".into(), "p".into());
        env.set_caller(env.get_account(0));
        (registry, s2)
    }

    #[test]
    fn challenge_uphold_slashes_panel_and_revokes_quorum() {
        let env = odra_test::env();
        let (mut registry, s2) = registry_with_quorum(&env, 1_000_000);
        assert_eq!(registry.require_quorum("req".into(), "h".into()), env.get_account(0));
        let challenger = env.get_account(3);
        let bond = U512::from(500_000_000u64);
        let before = env.balance_of(&challenger);
        env.set_caller(challenger);
        registry.with_tokens(bond).challenge("req".into(), "counter".into());
        // frozen while the challenge is pending
        assert_eq!(
            registry.try_require_quorum("req".into(), "h".into()),
            Err(Error::ChallengePending.into())
        );
        env.set_caller(env.get_account(0));
        registry.resolve_challenge("req".into(), true);
        // quorum revoked forever, panel slashed, bond refunded
        assert!(registry.is_revoked("req".into()));
        assert_eq!(
            registry.try_require_quorum("req".into(), "h".into()),
            Err(Error::NoQuorum.into())
        );
        assert!(!registry.is_trusted(env.get_account(0)));
        assert!(!registry.is_trusted(s2));
        assert_eq!(env.balance_of(&challenger), before);
    }

    #[test]
    fn challenge_reject_keeps_quorum_and_forfeits_bond() {
        let env = odra_test::env();
        let (mut registry, _s2) = registry_with_quorum(&env, 1_000_000);
        let challenger = env.get_account(3);
        let bond = U512::from(500_000_000u64);
        let before = env.balance_of(&challenger);
        env.set_caller(challenger);
        registry.with_tokens(bond).challenge("req".into(), "counter".into());
        env.set_caller(env.get_account(0));
        registry.resolve_challenge("req".into(), false);
        assert!(!registry.is_revoked("req".into()));
        assert_eq!(registry.require_quorum("req".into(), "h".into()), env.get_account(0));
        assert_eq!(env.balance_of(&challenger), before - bond); // bond forfeited
    }

    #[test]
    fn challenge_after_window_closes_reverts() {
        let env = odra_test::env();
        let (mut registry, _s2) = registry_with_quorum(&env, 1000);
        env.advance_block_time(5000);
        env.set_caller(env.get_account(3));
        assert_eq!(
            registry.try_challenge("req".into(), "counter".into()),
            Err(Error::ChallengeWindowClosed.into())
        );
    }

    #[test]
    fn cannot_challenge_request_without_quorum() {
        let env = odra_test::env();
        let mut registry = deploy(&env);
        registry.set_quorum(2);
        registry.set_challenge_window(1_000_000);
        registry.attest("req".into(), "h".into(), "a".into(), "p".into());
        env.set_caller(env.get_account(3));
        assert_eq!(
            registry.try_challenge("req".into(), "counter".into()),
            Err(Error::NoQuorum.into())
        );
    }

    #[test]
    fn challenge_counter_must_differ_from_winner() {
        let env = odra_test::env();
        let (mut registry, _s2) = registry_with_quorum(&env, 1_000_000);
        env.set_caller(env.get_account(3));
        assert_eq!(
            registry.try_challenge("req".into(), "h".into()),
            Err(Error::InvalidInput.into())
        );
    }

    #[test]
    fn double_challenge_reverts() {
        let env = odra_test::env();
        let (mut registry, _s2) = registry_with_quorum(&env, 1_000_000);
        env.set_caller(env.get_account(3));
        registry.challenge("req".into(), "counter".into());
        assert_eq!(
            registry.try_challenge("req".into(), "counter2".into()),
            Err(Error::AlreadyChallenged.into())
        );
    }

    #[test]
    fn only_owner_resolves_challenge() {
        let env = odra_test::env();
        let (mut registry, _s2) = registry_with_quorum(&env, 1_000_000);
        env.set_caller(env.get_account(3));
        registry.challenge("req".into(), "counter".into());
        assert_eq!(
            registry.try_resolve_challenge("req".into(), true),
            Err(Error::NotOwner.into())
        );
    }

    #[test]
    fn resolve_without_open_challenge_reverts() {
        let env = odra_test::env();
        let (mut registry, _s2) = registry_with_quorum(&env, 1_000_000);
        assert_eq!(
            registry.try_resolve_challenge("req".into(), true),
            Err(Error::NotChallenged.into())
        );
    }

    #[test]
    fn upheld_challenge_blocks_vault_release() {
        let env = odra_test::env();
        let (mut registry, mut vault) = deploy_pair(&env);
        registry.set_quorum(2);
        registry.set_challenge_window(1_000_000);
        let s2 = env.get_account(1);
        registry.set_trusted(s2, true);
        let beneficiary = env.get_account(3);
        vault.with_tokens(U512::from(1_000_000_000u64)).deposit("req".into(), beneficiary);
        registry.attest("req".into(), "h".into(), "a".into(), "p".into());
        env.set_caller(s2);
        registry.attest("req".into(), "h".into(), "b".into(), "p".into());
        env.set_caller(env.get_account(4));
        registry.challenge("req".into(), "counter".into());
        env.set_caller(env.get_account(0));
        registry.resolve_challenge("req".into(), true);
        assert_eq!(
            vault.try_release("req".into(), "h".into()),
            Err(Error::NoQuorum.into())
        );
    }

    #[test]
    fn rechallenge_after_reject_accounts_bond_freshly() {
        // The bond is zeroed on resolve, so re-opening a challenge after a reject refunds only
        // the fresh bond on a later uphold — no stale accumulation drains the contract.
        let env = odra_test::env();
        let (mut registry, _s2) = registry_with_quorum(&env, 1_000_000);
        let challenger = env.get_account(3);
        env.set_caller(challenger);
        registry.with_tokens(U512::from(200_000_000u64)).challenge("req".into(), "counter".into());
        env.set_caller(env.get_account(0));
        registry.resolve_challenge("req".into(), false);

        let challenger2 = env.get_account(4);
        let bond2 = U512::from(300_000_000u64);
        let before2 = env.balance_of(&challenger2);
        env.set_caller(challenger2);
        registry.with_tokens(bond2).challenge("req".into(), "counter".into());
        env.set_caller(env.get_account(0));
        registry.resolve_challenge("req".into(), true);
        assert!(registry.is_revoked("req".into()));
        assert_eq!(env.balance_of(&challenger2), before2);
    }
}
