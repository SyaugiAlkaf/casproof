#![cfg_attr(not(test), no_std)]
#![cfg_attr(not(test), no_main)]
extern crate alloc;

use odra::prelude::*;

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

#[odra::odra_error]
pub enum Error {
    NotOwner = 1,
    NotTrusted = 2,
    NotAttested = 3,
    NoQuorum = 4,
    AlreadyVoted = 5,
    InvalidQuorum = 6,
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
/// agreeing set, and cannot reach quorum. This is the trustless integrity layer
/// that subjective accuracy/reputation oracles sit on top of.
#[odra::module(events = [OutputAttested, QuorumReached])]
pub struct AttestationRegistry {
    owner: Var<Address>,
    quorum_threshold: Var<u32>,
    trusted: Mapping<Address, bool>,
    attestation_count: Mapping<Address, u64>,
    attestations: Mapping<String, Attestation>,
    // distinct-signer agreement count, keyed by "{request_id}#{output_hash}".
    agreement: Mapping<String, u32>,
    // winning output hash once quorum is reached, keyed by request_id.
    quorum_output: Mapping<String, String>,
    // one-vote-per-signer-per-request guard, keyed by (request_id, signer).
    voted: Mapping<(String, Address), bool>,
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

        let agree_key = agreement_key(&request_id, &output_hash);
        let agreed = self.agreement.get(&agree_key).unwrap_or(0) + 1;
        self.agreement.set(&agree_key, agreed);

        self.env().emit_event(OutputAttested {
            request_id: request_id.clone(),
            output_hash: output_hash.clone(),
            model_id,
            signer,
            timestamp,
        });

        let threshold = self.quorum_threshold.get().unwrap_or(1);
        if agreed >= threshold && self.quorum_output.get(&request_id).is_none() {
            self.quorum_output.set(&request_id, output_hash.clone());
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

    /// How many distinct trusted signers have attested this exact output for this
    /// request (the live "k of n agree" figure).
    pub fn agreement_count(&self, request_id: String, output_hash: String) -> u32 {
        self.agreement.get(&agreement_key(&request_id, &output_hash)).unwrap_or(0)
    }

    pub fn threshold(&self) -> u32 {
        self.quorum_threshold.get().unwrap_or(1)
    }

    pub fn is_trusted(&self, signer: Address) -> bool {
        self.trusted.get(&signer).unwrap_or(false)
    }

    /// Portable agent reputation: how many outputs this signer has attested.
    pub fn reputation(&self, signer: Address) -> u64 {
        self.attestation_count.get(&signer).unwrap_or(0)
    }

    pub fn set_trusted(&mut self, signer: Address, trusted: bool) {
        self.assert_owner();
        self.trusted.set(&signer, trusted);
    }

    pub fn set_quorum(&mut self, threshold: u32) {
        self.assert_owner();
        if threshold == 0 {
            self.env().revert(Error::InvalidQuorum);
        }
        self.quorum_threshold.set(threshold);
    }

    fn assert_owner(&self) {
        if self.env().caller() != self.owner.get().unwrap_or_revert(&self.env()) {
            self.env().revert(Error::NotOwner);
        }
    }
}

/// Composite dictionary key for the agreement tally. Both parts are hex/opaque
/// tokens with no `#`, so the separator is unambiguous and reproducible off-chain.
fn agreement_key(request_id: &str, output_hash: &str) -> String {
    let mut key = String::with_capacity(request_id.len() + 1 + output_hash.len());
    key.push_str(request_id);
    key.push('#');
    key.push_str(output_hash);
    key
}

/// The registry as seen from another contract: PayoutVault calls these in-VM.
#[odra::external_contract]
pub trait Registry {
    fn verify(&self, output_hash: String) -> Option<Attestation>;
    fn quorum_of(&self, request_id: String) -> Option<String>;
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

/// A DeFi consumer contract. It releases a payout only if the presented output is
/// the quorum-attested result for the request — the verify-before-act decision runs
/// inside the Casper VM, so no off-chain agent can skip it. A poisoned feed (a hash
/// that did not reach quorum) reverts.
#[odra::module(events = [PayoutAuthorized])]
pub struct PayoutVault {
    registry: External<RegistryContractRef>,
}

#[odra::module]
impl PayoutVault {
    pub fn init(&mut self, registry: Address) {
        self.registry.set(registry);
    }

    /// Authorizes a payout for `request_id` against `output_hash`. Succeeds only if
    /// the registry reports `output_hash` as the quorum-attested result for that
    /// request; otherwise reverts (`NoQuorum`). Returns the lead signer's reputation.
    pub fn release(&mut self, request_id: String, output_hash: String, beneficiary: Address) -> u64 {
        match self.registry.quorum_of(request_id.clone()) {
            Some(winner) if winner == output_hash => {
                let signer = match self.registry.verify(output_hash.clone()) {
                    Some(record) => record.signer,
                    None => self.env().revert(Error::NotAttested),
                };
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
            _ => self.env().revert(Error::NoQuorum),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use odra::host::{Deployer, HostEnv, NoArgs};

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

    fn deploy_pair(env: &HostEnv) -> (AttestationRegistryHostRef, PayoutVaultHostRef) {
        let registry = AttestationRegistry::deploy(env, NoArgs);
        let vault = PayoutVault::deploy(env, PayoutVaultInitArgs { registry: registry.address() });
        (registry, vault)
    }

    #[test]
    fn vault_authorizes_release_when_quorum_met() {
        let env = odra_test::env();
        let (mut registry, mut vault) = deploy_pair(&env);
        registry.set_quorum(2);
        let s2 = env.get_account(1);
        registry.set_trusted(s2, true);

        registry.attest("req".into(), "h".into(), "model-a".into(), "p".into());
        env.set_caller(s2);
        registry.attest("req".into(), "h".into(), "model-b".into(), "p".into());

        let beneficiary = env.get_account(3);
        let reputation = vault.release("req".into(), "h".into(), beneficiary);
        assert_eq!(reputation, 1);
    }

    #[test]
    fn vault_reverts_without_quorum() {
        let env = odra_test::env();
        let (mut registry, mut vault) = deploy_pair(&env);
        registry.set_quorum(2);
        registry.attest("req".into(), "h".into(), "m".into(), "p".into());
        let beneficiary = env.get_account(3);
        assert_eq!(
            vault.try_release("req".into(), "h".into(), beneficiary),
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

        registry.attest("req".into(), "genuine".into(), "a".into(), "p".into());
        env.set_caller(s2);
        registry.attest("req".into(), "genuine".into(), "b".into(), "p".into());

        let beneficiary = env.get_account(3);
        assert_eq!(
            vault.try_release("req".into(), "poisoned".into(), beneficiary),
            Err(Error::NoQuorum.into())
        );
        assert!(vault.try_release("req".into(), "genuine".into(), beneficiary).is_ok());
    }
}
