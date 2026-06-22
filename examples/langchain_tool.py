"""
Wrap Casproof as an agent tool — generic pattern, shown with LangChain.

Works with any agent framework that supports callable tools. The same pattern
applies to LlamaIndex, AutoGen, CrewAI, and custom agent loops: instantiate
Casproof once, call verify_output inside your tool function.

Requires:
  pip install langchain langchain-anthropic
  pip install -e clients/python    (from casproof repo root)
  CASPROOF_ENDPOINT env var pointing at your verify server
  ANTHROPIC_API_KEY env var
"""

import os
from typing import Optional

from casproof import Casproof

CASPROOF_ENDPOINT = os.environ.get("CASPROOF_ENDPOINT", "http://localhost:4021/verify")
_cp = Casproof(endpoint=CASPROOF_ENDPOINT)


def casproof_verify(
    model_id: str,
    prompt: str,
    payload: dict,
    request_id: Optional[str] = None,
) -> dict:
    """
    Verify an AI output before acting on it.

    Returns a dict with keys: decision ("PROCEED"/"BLOCK"), attested, agreement, error.
    Always call this before releasing a payout, executing a trade, or taking any
    irreversible action derived from a model output.
    """
    d = _cp.verify_output(
        model_id=model_id,
        prompt=prompt,
        payload=payload,
        request_id=request_id,
    )
    return {
        "decision": d.decision,
        "attested": d.attested,
        "agreement": d.agreement,
        "error": d.error,
    }


try:
    from langchain.tools import StructuredTool
    from langchain_anthropic import ChatAnthropic
    from langchain.agents import AgentExecutor, create_tool_calling_agent
    from langchain_core.prompts import ChatPromptTemplate

    casproof_tool = StructuredTool.from_function(
        func=casproof_verify,
        name="casproof_verify",
        description=(
            "Verify an AI output against the on-chain Casproof registry before acting. "
            "Returns PROCEED if the output is attested and quorum is met, BLOCK otherwise. "
            "Always call before irreversible actions."
        ),
    )

    llm = ChatAnthropic(model="claude-opus-4-8")
    prompt = ChatPromptTemplate.from_messages(
        [
            ("system", "You are a DeFi agent. Before releasing any payout, use casproof_verify to check the model output."),
            ("human", "{input}"),
            ("placeholder", "{agent_scratchpad}"),
        ]
    )
    agent = create_tool_calling_agent(llm, [casproof_tool], prompt)
    executor = AgentExecutor(agent=agent, tools=[casproof_tool], verbose=True)

    if __name__ == "__main__":
        result = executor.invoke({
            "input": (
                "A producer agent valued PARK-NOTE-001 at $1,278,000 (model: claude-opus-4-8, "
                "request-id: rwa-001). Verify the output and tell me if it is safe to release the payout."
            )
        })
        print(result["output"])

except ImportError:
    if __name__ == "__main__":
        print("LangChain not installed — showing standalone usage only.")
        result = casproof_verify(
            model_id="claude-opus-4-8",
            prompt="Value PARK-NOTE-001 as of 2026-Q2",
            payload={"asset": "PARK-NOTE-001", "fairValueUsd": 1_278_000, "confidence": 0.82},
            request_id="rwa-001",
        )
        print(result)
