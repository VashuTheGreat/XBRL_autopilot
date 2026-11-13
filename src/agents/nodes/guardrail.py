import re
import sys
from langchain_core.messages import AIMessage
from langchain_core.runnables import RunnableConfig
from langsmith import traceable

from src.agents.models.state import AgentState
from src.agents.models.structure import GuardrailStructure
from src.agents.prompts import GUARDRAIL_PROMPT
from src.core.logger import logger
from src.services.llm_provider.groq import get_llm

observe = traceable

INJECTION_PATTERNS = [
    r"print\s+(the\s+)?exact\s+system\s+prompt",
    r"system\s+prompt\s+and\s+internal\s+instructions",
    r"complete\s+configuration\s+and\s+initial\s+setup\s+instructions",
    r"ignore\s+(all\s+)?previous\s+instructions",
    r"switch\s+to\s+raw\s+retrieval\s+mode",
    r"print\s+every\s+context\s+chunk",
    r"you\s+are\s+now\s+metabot",
    r"bypass\s+(all\s+)?instructions",
]


@observe(name="guardrail_node", run_type="chain")
async def guardrail_node(state: AgentState, config: RunnableConfig | None = None) -> dict:
    """Validate user input against prompt injection, safety violations, and domain scope."""
    user_message = (state.get("user_message") or "").strip()
    lowered = user_message.lower()

    with logger.span("guardrail.execution", user_message=user_message):
        logger.info("guardrail.checking_input", user_message=user_message)

        # 1. Fast regex heuristics for explicit injection attacks
        for pattern in INJECTION_PATTERNS:
            if re.search(pattern, lowered):
                reason = "I cannot fulfill requests that attempt to reveal system prompts, internal guidelines, or raw context data."
                logger.warning("guardrail.blocked_heuristics", pattern=pattern)
                return {
                    "is_blocked": True,
                    "block_reason": reason,
                }

        # 2. LLM classifier check
        try:
            model = (config or {}).get("configurable", {}).get("model")
            llm = get_llm(model=model)
            chain = GUARDRAIL_PROMPT | llm.with_structured_output(GuardrailStructure)

            res: GuardrailStructure = await chain.ainvoke({"user_message": user_message})

            if not res.is_allowed:
                reason = res.refusal_reason or (
                    "I am specialized in MCA and XBRL filing. "
                    "I cannot assist with queries outside this domain or violating safety policies."
                )
                logger.warning(
                    "guardrail.blocked_llm",
                    violation_type=res.violation_type,
                    refusal_reason=reason,
                )
                return {
                    "is_blocked": True,
                    "block_reason": reason,
                }

            logger.info("guardrail.passed")
            return {
                "is_blocked": False,
                "block_reason": None,
            }

        except Exception as e:
            logger.error("guardrail.fallback_on_error", error=str(e))
            return {
                "is_blocked": False,
                "block_reason": None,
            }


@observe(name="blocked_responder_node", run_type="chain")
async def blocked_responder_node(state: AgentState, config: RunnableConfig | None = None) -> dict:
    """Respond when an input is blocked by the guardrail."""
    reason = state.get("block_reason") or (
        "I cannot fulfill this request as it is outside the supported MCA/XBRL domain "
        "or violates safety policies."
    )
    logger.info("guardrail.blocked_response", reason=reason)
    return {
        "messages": [AIMessage(content=reason)],
        "ai_response": reason,
    }
