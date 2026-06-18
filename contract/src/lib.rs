#![cfg_attr(not(test), no_std)]
#![cfg_attr(not(test), no_main)]
extern crate alloc;

use odra::prelude::*;

#[odra::odra_type]
pub struct Attestation {
    pub signer: Address,
    pub model_id: String,
    pub prompt_hash: String,
    pub timestamp: u64,
}

#[odra::event]
pub struct OutputAttested {
    pub output_hash: String,
    pub model_id: String,
    pub signer: Address,
    pub timestamp: u64,
}

#[odra::odra_error]
pub enum Error {
    NotOwner = 1,
    AlreadyAttested = 2,
    NotTrusted = 3,
}

#[odra::module(events = [OutputAttested])]
pub struct AttestationRegistry {
    owner: Var<Address>,
    attestations: Mapping<String, Attestation>,
    trusted: Mapping<Address, bool>,
    attestation_count: Mapping<Address, u64>,
}

#[odra::module]
impl AttestationRegistry {
    pub fn init(&mut self) {
        let caller = self.env().caller();
        self.owner.set(caller);
        self.trusted.set(&caller, true);
    }

    pub fn attest(&mut self, output_hash: String, model_id: String, prompt_hash: String) {
        let signer = self.env().caller();
        if !self.trusted.get(&signer).unwrap_or(false) {
            self.env().revert(Error::NotTrusted);
        }
        if self.attestations.get(&output_hash).is_some() {
            self.env().revert(Error::AlreadyAttested);
        }
        let timestamp = self.env().get_block_time();
        self.attestations.set(
            &output_hash,
            Attestation {
                signer,
                model_id: model_id.clone(),
                prompt_hash,
                timestamp,
            },
        );
        self.attestation_count.add(&signer, 1);
        self.env().emit_event(OutputAttested {
            output_hash,
            model_id,
            signer,
            timestamp,
        });
    }

    pub fn verify(&self, output_hash: String) -> Option<Attestation> {
        self.attestations.get(&output_hash)
    }

    pub fn is_trusted(&self, signer: Address) -> bool {
        self.trusted.get(&signer).unwrap_or(false)
    }

    // Portable agent reputation: how many outputs this signer has attested.
    pub fn reputation(&self, signer: Address) -> u64 {
        self.attestation_count.get(&signer).unwrap_or(0)
    }

    pub fn set_trusted(&mut self, signer: Address, trusted: bool) {
        self.assert_owner();
        self.trusted.set(&signer, trusted);
    }

    fn assert_owner(&self) {
        if self.env().caller() != self.owner.get().unwrap_or_revert(&self.env()) {
            self.env().revert(Error::NotOwner);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use odra::host::{Deployer, NoArgs};

    #[test]
    fn attest_and_verify() {
        let env = odra_test::env();
        let mut registry = AttestationRegistry::deploy(&env, NoArgs);
        registry.attest("abc123".into(), "claude-opus-4-8".into(), "prompt-hash".into());
        let record = registry.verify("abc123".into());
        assert!(record.is_some());
        assert_eq!(record.unwrap().model_id, "claude-opus-4-8");
    }

    #[test]
    fn duplicate_attest_reverts() {
        let env = odra_test::env();
        let mut registry = AttestationRegistry::deploy(&env, NoArgs);
        registry.attest("dup".into(), "m".into(), "p".into());
        let res = registry.try_attest("dup".into(), "m".into(), "p".into());
        assert_eq!(res, Err(Error::AlreadyAttested.into()));
    }

    #[test]
    fn verify_unknown_returns_none() {
        let env = odra_test::env();
        let registry = AttestationRegistry::deploy(&env, NoArgs);
        assert!(registry.verify("never-attested".into()).is_none());
    }

    #[test]
    fn owner_is_trusted_by_default() {
        let env = odra_test::env();
        let registry = AttestationRegistry::deploy(&env, NoArgs);
        assert!(registry.is_trusted(env.get_account(0)));
        assert!(!registry.is_trusted(env.get_account(1)));
    }

    #[test]
    fn owner_can_add_a_trusted_signer() {
        let env = odra_test::env();
        let mut registry = AttestationRegistry::deploy(&env, NoArgs);
        let other = env.get_account(1);
        registry.set_trusted(other, true);
        assert!(registry.is_trusted(other));
    }

    #[test]
    fn non_owner_cannot_set_trusted() {
        let env = odra_test::env();
        let mut registry = AttestationRegistry::deploy(&env, NoArgs);
        let attacker = env.get_account(1);
        env.set_caller(attacker);
        let res = registry.try_set_trusted(attacker, true);
        assert_eq!(res, Err(Error::NotOwner.into()));
    }

    #[test]
    fn untrusted_signer_cannot_attest() {
        let env = odra_test::env();
        let mut registry = AttestationRegistry::deploy(&env, NoArgs);
        env.set_caller(env.get_account(1));
        let res = registry.try_attest("h".into(), "m".into(), "p".into());
        assert_eq!(res, Err(Error::NotTrusted.into()));
    }

    #[test]
    fn reputation_counts_a_signers_attestations() {
        let env = odra_test::env();
        let mut registry = AttestationRegistry::deploy(&env, NoArgs);
        let owner = env.get_account(0);
        assert_eq!(registry.reputation(owner), 0);
        registry.attest("a".into(), "m".into(), "p".into());
        registry.attest("b".into(), "m".into(), "p".into());
        assert_eq!(registry.reputation(owner), 2);
    }

    #[test]
    fn owner_can_onboard_a_signer_who_then_attests() {
        let env = odra_test::env();
        let mut registry = AttestationRegistry::deploy(&env, NoArgs);
        let oracle = env.get_account(1);
        registry.set_trusted(oracle, true);
        env.set_caller(oracle);
        registry.attest("h".into(), "m".into(), "p".into());
        assert_eq!(registry.verify("h".into()).unwrap().signer, oracle);
    }
}
