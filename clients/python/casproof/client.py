import json
import os
import urllib.request
from dataclasses import dataclass, field
from typing import Any, Optional

from .hashing import output_hash, prompt_hash

DEFAULT_ENDPOINT = os.environ.get("CASPROOF_ENDPOINT", "http://localhost:3000/api/verify")


@dataclass
class Decision:
    hash: str
    attested: bool
    decision: str  # "PROCEED" or "BLOCK"
    quorum_reached: Optional[bool] = None
    agreement: Optional[int] = None
    signer: Optional[str] = None
    error: Optional[str] = None
    raw: dict = field(default_factory=dict)

    @property
    def proceed(self) -> bool:
        return self.decision == "PROCEED"


class Casproof:
    """Verify-before-act client. Talks to the Casproof /verify HTTP API, which reads the
    on-chain attestation + quorum state for an output and returns a PROCEED/BLOCK decision."""

    def __init__(self, endpoint: str = DEFAULT_ENDPOINT, timeout: float = 15.0):
        self.endpoint = endpoint
        self.timeout = timeout

    def hash(self, payload: Any) -> str:
        return output_hash(payload)

    def prompt_hash(self, prompt: str) -> str:
        return prompt_hash(prompt)

    def verify_output(self, model_id: str, prompt: str, payload: Any, request_id: Optional[str] = None) -> Decision:
        body: dict = {"feed": {"modelId": model_id, "prompt": prompt, "payload": payload}}
        if request_id:
            body["requestId"] = request_id
        return self._decide(output_hash(payload), request_id, self._post(body))

    def verify_hash(self, out_hash: str, request_id: Optional[str] = None) -> Decision:
        body: dict = {"hash": out_hash}
        if request_id:
            body["requestId"] = request_id
        return self._decide(out_hash, request_id, self._post(body))

    def _post(self, body: dict) -> dict:
        req = urllib.request.Request(
            self.endpoint,
            data=json.dumps(body).encode("utf-8"),
            headers={"content-type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=self.timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))

    @staticmethod
    def _decide(out_hash: str, request_id: Optional[str], data: dict) -> Decision:
        if data.get("error"):
            return Decision(hash=out_hash, attested=False, decision="BLOCK", error=data["error"], raw=data)
        attested = bool(data.get("attested"))
        trusted = data.get("trusted", True)
        quorum = data.get("quorum")
        if request_id and isinstance(quorum, dict):
            proceed = attested and bool(trusted) and bool(quorum.get("matchesWinner"))
            return Decision(
                hash=out_hash,
                attested=attested,
                decision="PROCEED" if proceed else "BLOCK",
                quorum_reached=quorum.get("reached"),
                agreement=quorum.get("agreement"),
                signer=data.get("signer"),
                raw=data,
            )
        proceed = attested and bool(trusted)
        return Decision(
            hash=out_hash,
            attested=attested,
            decision="PROCEED" if proceed else "BLOCK",
            signer=data.get("signer"),
            raw=data,
        )
