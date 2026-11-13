from functools import lru_cache
from typing import Optional
from langchain_groq import ChatGroq
from src.app_config import get_app_config

app_config = get_app_config()
DEFAULT_MODEL = app_config.groq_model or "openai/gpt-oss-120b"

AVAILABLE_MODELS = frozenset({
    "llama-3.3-70b-versatile",
    "llama-3.1-8b-instant",
    "llama3-70b-8192",
    "llama3-8b-8192",
    "mixtral-8x7b-32768",
    "qwen/qwen3.8-27b",
    "canopylabs/orpheus-arabic-saudi",
    "canopylabs/orpheus-v1-english",
    "meta-llama/llama-prompt-guard-2-22m",
    "meta-llama/llama-prompt-guard-2-86m",
    "openai/gpt-oss-120b",
    "openai/gpt-oss-20b",
    "openai/gpt-oss-safeguard-20b",
    DEFAULT_MODEL,
})


@lru_cache
def get_llm(model: Optional[str] = None):
    chosen_model = model or DEFAULT_MODEL
    return ChatGroq(
        model=chosen_model,
        api_key=app_config.groq_api_key,
    )
