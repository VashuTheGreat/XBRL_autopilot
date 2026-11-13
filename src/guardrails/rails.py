from typing import Tuple, Optional
from langchain_groq import ChatGroq
from src.app_config import get_app_config
from src.core.logger import logger
from src.guardrails.colang_rule import COLANG_CONTENT, YAML_CONTENT, RAIL_INDICATORS

try:
    from nemoguardrails import RailsConfig, LLMRails
except ImportError:
    RailsConfig = None
    LLMRails = None

_rails = None


def get_guardrails():
    """Initialize and return the LLMRails instance with the specified configuration."""
    global _rails
    if _rails is not None:
        return _rails

    if LLMRails is None or RailsConfig is None:
        logger.info("guardrails.not_installed_bypassing")
        return None

    config = get_app_config()
    kwargs = {
        "model": "openai/gpt-oss-20b",
        "api_key": config.groq_api_key,
        "streaming": False,
        "reasoning_format": "hidden",
        "reasoning_effort": "low",
    }

    guard_llm = ChatGroq(**kwargs)
    rails_config = RailsConfig.from_content(
        colang_content=COLANG_CONTENT,
        yaml_content=YAML_CONTENT,
    )

    _rails = LLMRails(rails_config, llm=guard_llm)
    logger.info("guardrails.initialized")
    return _rails


def guard(message: str) -> Tuple[bool, Optional[str]]:
    """Run a user message through the NeMo rails gate."""
    if _rails is None:
        logger.debug("guardrails.not_active_skipping")
        return False, None

    with logger.span("guardrails.check"):
        result = _rails.generate(messages=[{"role": "user", "content": message}])
        content = result.get("content", "") if isinstance(result, dict) else str(result)
        normalized_content = " ".join(content.casefold().replace("’", "'").split())
        fired = any(
            " ".join(indicator.casefold().replace("’", "'").split()) in normalized_content
            for indicator in RAIL_INDICATORS
        )

        if fired:
            logger.info("guardrails.fired", query_preview=message[:80])
            return True, content

        logger.info("guardrails.passed")
        return False, None
