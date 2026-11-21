"""Rate-limit model switching (docs/17): a 429 on one Groq model retries the same call on the next one."""
import httpx
import groq
import pytest
from langchain_core.language_models.fake_chat_models import FakeListChatModel
from langchain_core.messages import AIMessage

from src.services.llm_provider.groq import fallback_chain, with_rate_limit_fallback


def _rate_limit() -> groq.RateLimitError:
    req = httpx.Request("POST", "https://api.groq.com/openai/v1/chat/completions")
    return groq.RateLimitError("rate limited", response=httpx.Response(429, request=req), body=None)


class RateLimitedModel(FakeListChatModel):
    calls: int = 0

    def _call(self, *args, **kwargs):  # noqa: D401
        self.calls += 1
        raise _rate_limit()


class BrokenModel(FakeListChatModel):
    def _call(self, *args, **kwargs):
        raise ValueError("not a rate limit")


def test_chain_puts_the_chosen_model_first_without_duplicates():
    assert fallback_chain("b", ["a", "b", " ", "c"]) == ["b", "a", "c"]


def test_rate_limit_switches_to_the_next_model_mid_run():
    first = RateLimitedModel(responses=["unused"])
    llm = with_rate_limit_fallback([first, FakeListChatModel(responses=["from second"])])
    out = llm.invoke("hi")
    assert isinstance(out, AIMessage) and out.content == "from second"
    assert first.calls == 1


def test_walks_the_whole_chain():
    llm = with_rate_limit_fallback([RateLimitedModel(responses=["x"]), RateLimitedModel(responses=["x"]), FakeListChatModel(responses=["third"])])
    assert llm.invoke("hi").content == "third"


def test_other_errors_are_not_hidden():
    llm = with_rate_limit_fallback([BrokenModel(responses=["x"]), FakeListChatModel(responses=["second"])])
    with pytest.raises(ValueError):
        llm.invoke("hi")


def test_single_model_is_returned_as_is():
    m = FakeListChatModel(responses=["only"])
    assert with_rate_limit_fallback([m]) is m


def test_bind_applies_to_every_model_in_the_chain():
    llm = with_rate_limit_fallback([RateLimitedModel(responses=["x"]), FakeListChatModel(responses=["bound"])])
    assert llm.bind(stop=["\n"]).invoke("hi").content == "bound"
