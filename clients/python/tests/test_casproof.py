import unittest

from casproof import agreement_key, canonical, output_hash, prompt_hash, state_item_key
from casproof.client import Casproof


class HashVectors(unittest.TestCase):
    def test_output_hash_matches_the_cross_language_vector(self):
        payload = {"asset": "PARK-NOTE-001", "fairValueUsd": 1234567, "confidence": 0.82}
        self.assertEqual(output_hash(payload), "83784d8eadfb07e174eab9591ca4d4cd8a059053a5b564a196b3b2eae6003a08")

    def test_prompt_hash_matches_the_blake2b_vector(self):
        self.assertEqual(prompt_hash("hello"), "324dcf027dd4a30a932c441f365a25e86b173defa4b8e58948253471b81b72cf")

    def test_canonical_is_independent_of_key_order(self):
        self.assertEqual(canonical({"a": 1, "b": 2}), canonical({"b": 2, "a": 1}))
        self.assertEqual(canonical({"x": {"p": 1, "q": 2}}), canonical({"x": {"q": 2, "p": 1}}))

    def test_state_item_key_matches_the_odra_derivation_vector(self):
        self.assertEqual(
            state_item_key(1, "abc123"),
            "9f2378c44002082211ef5af96b30c62e63952032a00db869e75e6cc95c9b0428",
        )

    def test_agreement_and_quorum_keys_are_distinct_namespaces(self):
        out = "a" * 64
        self.assertNotEqual(state_item_key(5, agreement_key("r", out)), state_item_key(6, "r"))


class DecisionLogic(unittest.TestCase):
    def test_block_when_unattested(self):
        d = Casproof._decide("h", None, {"hash": "h", "attested": False})
        self.assertEqual(d.decision, "BLOCK")
        self.assertFalse(d.proceed)

    def test_proceed_on_quorum_match(self):
        data = {"hash": "h", "attested": True, "trusted": True,
                "quorum": {"reached": True, "matchesWinner": True, "agreement": 2, "winningHash": "h"}}
        d = Casproof._decide("h", "req1", data)
        self.assertEqual(d.decision, "PROCEED")
        self.assertEqual(d.agreement, 2)

    def test_block_when_hash_is_not_the_quorum_winner(self):
        data = {"hash": "h", "attested": True, "trusted": True,
                "quorum": {"reached": True, "matchesWinner": False, "agreement": 2, "winningHash": "other"}}
        d = Casproof._decide("h", "req1", data)
        self.assertEqual(d.decision, "BLOCK")

    def test_error_response_blocks(self):
        d = Casproof._decide("h", None, {"error": "registry not configured"})
        self.assertEqual(d.decision, "BLOCK")
        self.assertEqual(d.error, "registry not configured")


if __name__ == "__main__":
    unittest.main()
