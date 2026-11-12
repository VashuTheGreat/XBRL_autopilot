"""AI fix agent (ADR-0012): shared Groq client, privacy check, tools, agent loop and route — all without network
(a scripted fake LLM, or urlopen patched). No client data: a synthetic C&I bundle."""
import io
import json
import re
import urllib.error
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from api.app import app
from src.services.fix_agent import agent as agent_mod
from src.services.fix_agent.agent import FINAL_NUDGE, run_agent
from src.services.fix_agent.bundle import FixRequest
from src.services.fix_agent.privacy import IDENTITY_ELEMENT, violations
from src.services.fix_agent.tools import FixTools
from src.services.llm import groq as groq_mod
from src.services.llm.groq import ChatResult, GroqClient, GroqError, Usage, resolve_url
from src.services.tagging.rerank import GroqReranker, RerankItem, RerankOption

ROOT = Path(__file__).resolve().parent.parent
CELL_PY = {"workbook": "workbook-1.xlsx", "sheet": "BS", "ref": "D9"}
CELL_CY = {"workbook": "workbook-1.xlsx", "sheet": "BS", "ref": "C9"}
SC_PY = "in-gaap:ShareCapital#2013-03-31#"


def bundle(**over) -> dict:
    b = {
        "taxonomy": "ci_taxonomy",
        "problem": {
            "id": "engine:rule.GR-6|x#1", "severity": "error", "family": "rule", "code": "rule.GR-6", "ruleId": "GR-6",
            "message": "[GR-6] ShareCapital is reported for the previous year but not for the current year",
            "elrCode": "100100", "concept": "in-gaap:ShareCapital", "scope": "PY", "factKey": SC_PY, "cell": CELL_PY,
            "rule": {"id": "GR-6", "text": "CY/PY pairing", "implementation": "generic:cy-py-pairing"},
        },
        "facts": [
            {"key": SC_PY, "concept": "in-gaap:ShareCapital", "label": "Share capital", "dataType": "monetary", "scope": "PY",
             "period": "2013-03-31", "value": "500000", "display": "500000", "decimals": "0", "origin": "user", "cell": CELL_PY,
             "elrs": ["100100"]},
            {"key": "in-gaap:ReservesAndSurplus#2013-03-31#", "concept": "in-gaap:ReservesAndSurplus", "label": "Reserves and surplus",
             "dataType": "monetary", "scope": "PY", "period": "2013-03-31", "value": "120000", "display": "120000", "elrs": ["100100"]},
        ],
        "sources": [
            {"cell": CELL_PY, "label": "Share capital", "value": 500000,
             "neighbours": [{"ref": "C9", "value": 650000, "column": "CY"}, {"ref": "D9", "value": 500000, "column": "PY"}]},
        ],
        "meta": {"reportType": "Standalone", "cyStart": "2013-04-01", "cyEnd": "2014-03-31", "pyStart": "2012-04-01",
                 "pyEnd": "2013-03-31", "level": "Actual"},
    }
    b.update(over)
    return b


def tool_call(name: str, args: dict, i: int = 1) -> ChatResult:
    return ChatResult({"role": "assistant", "content": None,
                       "tool_calls": [{"id": f"c{i}", "type": "function", "function": {"name": name, "arguments": json.dumps(args)}}]},
                      Usage(100, 20))


def answer(obj) -> ChatResult:
    return ChatResult({"role": "assistant", "content": obj if isinstance(obj, str) else json.dumps(obj)}, Usage(200, 50))


GOOD = {
    "summary": "The current-year share capital is in C9, next to the previous-year figure.",
    "patches": [{"op": "setValue", "fact": {"concept": "in-gaap:ShareCapital", "scope": "CY"}, "value": "650000",
                 "source": {"kind": "cell", "cell": CELL_CY}, "rationale": "C9 is the CY column", "confidence": 0.9}],
    "resolves": ["engine:rule.GR-6|x#1"], "needsHuman": False,
}


class FakeLLM:
    """Plays back scripted replies and records what it was sent."""

    def __init__(self, replies):
        self.replies = list(replies)
        self.calls = []

    def chat(self, messages, *, tools=None, tool_choice=None, response_format=None, temperature=0):
        self.calls.append({"messages": [dict(m) for m in messages], "tool_choice": tool_choice, "tools": tools})
        return self.replies.pop(0)


# ------------------------------------------------------------------ shared Groq client
class _Resp(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def _ok(content="{}"):
    return _Resp(json.dumps({"choices": [{"message": {"role": "assistant", "content": content}}],
                             "usage": {"prompt_tokens": 7, "completion_tokens": 3}}).encode())


def _http(code, retry_after=None):
    headers = {"retry-after": str(retry_after)} if retry_after is not None else {}
    return urllib.error.HTTPError("u", code, "x", headers, None)


def test_groq_client_retries_429_and_5xx_with_backoff(monkeypatch):
    seq = [_http(429, retry_after=2), _http(503), _ok('{"a":1}')]
    sent, slept = [], []

    def fake(req, timeout):
        sent.append((req.full_url, json.loads(req.data), timeout))
        r = seq.pop(0)
        if isinstance(r, Exception):
            raise r
        return r

    monkeypatch.setattr(groq_mod.urllib.request, "urlopen", fake)
    c = GroqClient("k", "m", url="http://127.0.0.1:9/v1/chat", timeout_s=60, sleep=slept.append)
    res = c.chat([{"role": "user", "content": "hi"}], response_format={"type": "json_object"})
    assert res.content == '{"a":1}' and res.usage.total_tokens == 10
    assert slept == [2.0, 2.0]  # Retry-After, then backoff 1 × 2^1
    assert sent[0][0] == "http://127.0.0.1:9/v1/chat" and sent[0][2] == 60
    assert sent[0][1]["model"] == "m" and sent[0][1]["temperature"] == 0


def test_groq_client_does_not_retry_client_errors_or_timeouts(monkeypatch):
    calls = []

    def bad(req, timeout):
        calls.append(1)
        raise _http(400)

    monkeypatch.setattr(groq_mod.urllib.request, "urlopen", bad)
    with pytest.raises(GroqError) as e:
        GroqClient("k", "m", sleep=lambda s: None).chat([])
    assert e.value.status == 400 and len(calls) == 1

    def slow(req, timeout):
        calls.append(2)
        raise TimeoutError()

    monkeypatch.setattr(groq_mod.urllib.request, "urlopen", slow)
    with pytest.raises(GroqError, match="timed out"):
        GroqClient("k", "m", sleep=lambda s: None).chat([])
    assert calls.count(2) == 1


def test_groq_url_must_be_https_or_loopback():
    assert resolve_url(None) == groq_mod.GROQ_URL
    assert resolve_url("http://localhost:8765/openai/v1/chat/completions").startswith("http://localhost")
    with pytest.raises(ValueError):
        resolve_url("http://example.com/v1")


def test_rerank_goes_through_the_shared_client():
    item = RerankItem(1, "Trade receivables", [], "balance_sheet", [RerankOption("in-gaap:TradeReceivablesCurrent", "Trade receivables", "instant", "debit")])
    fake = FakeLLM([answer({"rows": [{"id": 1, "concept": "in-gaap:TradeReceivablesCurrent", "confidence": 0.8, "reason": "same"}]})])
    out = GroqReranker("k", "m", client=fake).rerank([item])
    assert out[1].qname == "in-gaap:TradeReceivablesCurrent"


# ------------------------------------------------------------------ privacy
def test_privacy_rejects_identity_long_text_and_other_text_blocks():
    assert violations(FixRequest(**bundle())) == []
    b = bundle()
    b["facts"].append({"key": "k1", "concept": "in-gaap:NameOfCompany", "period": "2014-03-31", "value": "X"})
    b["facts"].append({"key": "k2", "concept": "in-gaap:DisclosureOfNotesTextBlock", "dataType": "textBlock", "period": "2014-03-31", "value": "t"})
    b["problem"]["message"] += " (CIN U72200KA2010PLC123456)"
    found = violations(FixRequest(**b))
    assert any("NameOfCompany" in v for v in found)
    assert any("text block" in v for v in found)
    assert any("a CIN in bundle.problem.message" == v for v in found)
    with pytest.raises(Exception):  # longer than 200 characters is refused by the schema itself
        FixRequest(**bundle(facts=[{"key": "k", "concept": "in-gaap:X", "period": "p", "value": "x" * 201}]))


def test_rule_text_may_show_format_examples():
    b = bundle()
    b["problem"]["rule"]["text"] = "PAN should be in the format AAAAA9999A"
    assert violations(FixRequest(**b)) == []


def test_identity_pattern_is_the_same_as_the_apps():
    ts = (ROOT / "ui" / "shared" / "privacy.ts").read_text(encoding="utf-8")
    m = re.search(r"IDENTITY_ELEMENT\s*=\s*/(.+)/\s*$", ts, re.M)
    assert m, "IDENTITY_ELEMENT not found in ui/shared/privacy.ts"
    assert m.group(1) == IDENTITY_ELEMENT.pattern


# ------------------------------------------------------------------ tools
def test_tools_answer_from_the_knowledge_base_and_the_bundle():
    t = FixTools(FixRequest(**bundle()))
    c = json.loads(t.call("get_concept", {"qname": "in-gaap:ShareCapital"}))
    assert c["periodType"] == "instant" and c["balance"] == "credit" and "100100" in c["elrCodes"]
    tree = json.loads(t.call("get_calc_tree", '{"concept":"in-gaap:ShareholdersFunds","elr_code":"100100"}'))
    kids = {k["concept"]: k for n in tree["networks"] for k in n["children"]}
    assert "in-gaap:ShareCapital" in kids and kids["in-gaap:ShareCapital"]["values"][0]["display"] == "500000"
    rule = json.loads(t.call("get_rule", {"rule_id": "GR-6"}))
    assert rule["rule"]["id"] == "GR-6" and rule["rule"]["status"] == "EXECUTABLE"
    hits = json.loads(t.call("search_taxonomy", {"text": "share capital", "limit": 5}))["items"]
    assert "in-gaap:ShareCapital" in [h["qname"] for h in hits]
    assert json.loads(t.call("facts_in_elr", {"elr_code": "100100"}))["count"] == 2
    row = json.loads(t.call("get_source_row", {"sheet": "BS", "ref": "d9"}))
    assert "error" in json.loads(t.call("get_source_row", {"sheet": "BS", "ref": "C9"}))  # only a neighbour of D9
    assert row["neighbours"][0] == {"ref": "C9", "value": 650000.0, "column": "CY"}
    assert "error" in json.loads(t.call("get_concept", {"qname": "in-gaap:Nope"}))
    assert "unknown tool" in json.loads(t.call("rm_rf", {}))["error"]
    assert "bad arguments" in json.loads(t.call("get_concept", {"wrong": 1}))["error"]


# ------------------------------------------------------------------ agent loop
def test_agent_accepts_a_neighbour_cell_of_a_source_row_as_the_source():
    # C9 is not a source row of its own: it is the current-year cell next to D9 (what a model naturally cites)
    res = run_agent(FakeLLM([answer(GOOD)]), FixRequest(**bundle()))
    assert res.patches and res.dropped == []


def test_agent_calls_tools_then_returns_checked_patches():
    fake = FakeLLM([tool_call("get_source_row", {"sheet": "BS", "ref": "D9"}), answer(GOOD)])
    res = run_agent(fake, FixRequest(**bundle()))
    assert res.stop == "answered" and res.steps == 2 and not res.needs_human
    assert res.patches == [GOOD["patches"][0]] and res.dropped == []
    assert res.tool_calls == [{"name": "get_source_row", "arguments": {"sheet": "BS", "ref": "D9"}}]
    assert res.usage.total_tokens == 370
    # the tool result went back to the model under the call's id; the bundle went as the user message
    sent = fake.calls[1]["messages"]
    assert sent[-1]["role"] == "tool" and sent[-1]["tool_call_id"] == "c1" and "650000" in sent[-1]["content"]
    assert json.loads(sent[1]["content"])["problem"]["ruleId"] == "GR-6"
    assert fake.calls[0]["tool_choice"] == "auto" and len(fake.calls[0]["tools"]) == 6


def test_agent_stops_calling_tools_at_the_step_limit():
    b = bundle(options={"maxSteps": 3})
    fake = FakeLLM([tool_call("get_concept", {"qname": "in-gaap:ShareCapital"}, i) for i in (1, 2)] + [answer(GOOD)])
    res = run_agent(fake, FixRequest(**b))
    assert res.steps == 3 and len(fake.calls) == 3
    assert fake.calls[2]["tool_choice"] == "none" and fake.calls[2]["messages"][-1]["content"] == FINAL_NUDGE
    assert res.patches


def test_agent_repairs_an_unreadable_answer_once_and_gives_up_after():
    res = run_agent(FakeLLM([answer("Sure! Here is the fix."), answer("```json\n" + json.dumps(GOOD) + "\n```")]), FixRequest(**bundle()))
    assert res.patches and res.steps == 2
    res = run_agent(FakeLLM([answer("no"), answer("still no")]), FixRequest(**bundle(options={"maxSteps": 2})))
    assert res.stop == "unparsable" and res.needs_human and res.patches == []


def test_agent_drops_patches_the_bundle_cannot_back():
    bad = dict(GOOD, patches=[
        {"op": "setValue", "fact": {"concept": "in-gaap:ShareCapital", "scope": "CY"}, "value": "650000",
         "source": {"kind": "cell", "cell": {"workbook": "workbook-1.xlsx", "sheet": "BS", "ref": "Z1"}}},
        {"op": "setValue", "fact": {"concept": "in-gaap:ShareCapital", "scope": "CY"}, "value": "about 6 lakh",
         "source": {"kind": "identity", "terms": [{"factKey": SC_PY, "weight": 1}]}},
        {"op": "remap", "cell": CELL_PY, "from": "in-gaap:ShareCapital", "to": "in-gaap:NoSuchElement"},
        {"op": "removeFact", "fact": {"concept": "in-gaap:ShareCapital", "scope": "PY"}},
        {"op": "setNil", "fact": {"key": "not-in-bundle", "concept": "in-gaap:NoSuchElement", "scope": "CY"}},
        {"op": "deleteEverything"},
        {"op": "setValue", "fact": {"concept": "in-gaap:ShareCapital", "scope": "CY"}, "value": None, "source": {"kind": "user"},
         "rationale": "the CY figure is not in the workbook"},
    ])
    res = run_agent(FakeLLM([answer(bad)]), FixRequest(**bundle()))
    reasons = [d["reason"] for d in res.dropped]
    assert len(res.patches) == 1 and res.patches[0]["source"] == {"kind": "user"}
    assert reasons[:5] == [
        "the source cell is not in the bundle",
        "setValue needs a plain number",
        "in-gaap:NoSuchElement is not an element of this taxonomy",
        "removeFact needs the key of an existing fact",
        "in-gaap:NoSuchElement is not an element of this taxonomy",
    ]
    assert reasons[5].startswith("invalid patch")


def test_agent_reads_confidence_given_in_words_or_percent():
    # gpt-oss-120b answered "confidence":"high" in the first live run: the patch was right and must not be dropped
    patches = [dict(GOOD["patches"][0], confidence=c) for c in ("high", "85%", 85, "0.7", "unsure")]
    res = run_agent(FakeLLM([answer(dict(GOOD, patches=patches))]), FixRequest(**bundle()))
    assert [p["confidence"] for p in res.patches] == [0.85, 0.85, 0.85, 0.7, 0.5] and res.dropped == []


def test_a_made_up_fact_id_on_a_set_op_is_ignored_but_a_removal_needs_a_real_one():
    new = dict(GOOD["patches"][0], fact={"key": "f4", "concept": "in-gaap:ShareCapital", "scope": "CY"})
    rm = {"op": "removeFact", "fact": {"key": "f4", "concept": "in-gaap:ShareCapital", "scope": "PY"}}
    res = run_agent(FakeLLM([answer(dict(GOOD, patches=[new, rm]))]), FixRequest(**bundle()))
    assert res.patches[0]["fact"] == {"concept": "in-gaap:ShareCapital", "scope": "CY"}
    assert [d["reason"] for d in res.dropped] == ["the fact is not in the bundle"]


def test_agent_recovers_from_a_malformed_tool_call(monkeypatch):
    class Flaky(FakeLLM):
        def chat(self, messages, **kw):
            if not self.calls:
                self.calls.append({"messages": messages, **kw})
                raise GroqError("LLM request failed (HTTP 400): tool_use_failed: Failed to call a function", 400)
            return super().chat(messages, **kw)

    fake = Flaky([answer(GOOD)])
    res = run_agent(fake, FixRequest(**bundle()))
    assert res.patches and res.steps == 2
    assert "invalid" in fake.calls[1]["messages"][-1]["content"]


def test_agent_honours_the_token_budget():
    heavy = ChatResult(tool_call("get_concept", {"qname": "in-gaap:ShareCapital"}).message, Usage(5000, 0))
    res = run_agent(FakeLLM([heavy]), FixRequest(**bundle(options={"maxTokens": 1000})))
    assert res.stop == "token-budget" and res.patches == []


# ------------------------------------------------------------------ route
client = TestClient(app)


def test_route_is_off_without_a_key(monkeypatch):
    monkeypatch.setattr("api.v1.routes.fix.client_from_config", lambda: None)
    r = client.post("/api/v1/fix/propose", json=bundle())
    assert r.status_code == 409 and r.json()["errors"][0]["type"] == "ai.disabled"


def test_route_refuses_identity_data_before_any_llm_call(monkeypatch):
    called = []
    monkeypatch.setattr("api.v1.routes.fix.client_from_config", lambda: called.append(1))
    b = bundle()
    b["facts"].append({"key": "k", "concept": "in-gaap:CorporateIdentityNumber", "period": "2014-03-31", "value": "x"})
    r = client.post("/api/v1/fix/propose", json=b)
    assert r.status_code == 422 and r.json()["errors"][0]["type"] == "privacy" and not called


def test_route_returns_the_agents_patches(monkeypatch):
    fake = FakeLLM([tool_call("get_rule", {"rule_id": "GR-6"}), answer(GOOD)])
    fake.model = "fake-model"
    monkeypatch.setattr("api.v1.routes.fix.client_from_config", lambda: fake)
    r = client.post("/api/v1/fix/propose", json=bundle())
    assert r.status_code == 200, r.text
    d = r.json()["data"]
    assert d["patches"] == GOOD["patches"] and d["model"] == "fake-model" and d["steps"] == 2
    assert d["usage"]["totalTokens"] == 370 and d["toolCalls"][0]["name"] == "get_rule"


def test_route_validation():
    assert client.post("/api/v1/fix/propose", json=bundle(taxonomy="costing_taxonomy")).status_code == 422
    assert client.post("/api/v1/fix/propose", json=bundle(options={"maxSteps": 7})).status_code == 422


def test_agent_module_keeps_the_prompt_honest():
    p = agent_mod.SYSTEM_PROMPT
    for op in ("setValue", "setNil", "remap", "setScope", "removeFact", "setText"):
        assert op in p
    assert "Never invent an amount" in p
