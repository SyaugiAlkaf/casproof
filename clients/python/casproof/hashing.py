import hashlib
import json
from typing import Any


def canonical(value: Any) -> str:
    """Canonical JSON: keys sorted at every depth, compact separators. Byte-matches
    the TypeScript/agent and on-chain hashing so Python-computed hashes resolve."""
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def output_hash(payload: Any) -> str:
    """BLAKE2b-256 (hex) of the canonical payload — the registry's output hash."""
    return hashlib.blake2b(canonical(payload).encode("utf-8"), digest_size=32).hexdigest()


def prompt_hash(prompt: str) -> str:
    return hashlib.blake2b(prompt.encode("utf-8"), digest_size=32).hexdigest()


def agreement_key(request_id: str, out_hash: str) -> str:
    return f"{request_id}#{out_hash}"


def state_item_key(field_index: int, key: str) -> str:
    """Odra storage dictionary item key: blake2b256(u32_be(field) ++ u32_le(len) ++ utf8(key)).
    Mirrors agents/src/casper.ts so direct on-chain reads target the right item."""
    utf8 = key.encode("utf-8")
    preimage = field_index.to_bytes(4, "big") + len(utf8).to_bytes(4, "little") + utf8
    return hashlib.blake2b(preimage, digest_size=32).hexdigest()
