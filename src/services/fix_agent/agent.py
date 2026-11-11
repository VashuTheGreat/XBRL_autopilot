"""The fix agent's loop: problem + bundle → tool calls (at most ``maxSteps`` LLM calls) → a checked patch list.

The model may only read (tools) and answer; its answer is parsed as strict JSON and every patch is checked against the
bundle and the taxonomy (patches.check_patches). It never writes anything: the app shows the patches, the engine checks
them again, and only the user applies them.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import Any

from src.services.fix_agent.bundle import FixRequest
from src.services.fix_agent.patches import check_patches
from src.services.fix_agent.tools import TOOL_SPECS, FixTools
from src.services.llm.groq import ChatModel, GroqError, Usage

SYSTEM_PROMPT = """You fix validation errors in Indian MCA AOC-4 XBRL filings (Companies Act 2013; C&I 2016 or Ind AS 2017 taxonomy).
You get ONE problem and a bundle: the problem (rule id, rule, message, location), the filing's related facts
(value = as in the XML, amounts in rupees; display = as presented in the filing's rounding level), the Excel rows the
amounts came from, and filing meta. Use the tools to look up elements, rules, calculation trees, facts and source rows.

Propose the smallest set of patches that resolves the problem. Every patch has "rationale" (one sentence) and
"confidence" (a number from 0 to 1, e.g. 0.85; never a word). Patch ops (JSON):
- {"op":"setValue","fact":{"key"?,"concept","scope":"CY"|"PY"},"value":"<number as presented>","source":SOURCE,"rationale","confidence"}
- {"op":"setNil","fact":{...},"rationale","confidence"}            report the element as nil (no value)
- {"op":"remap","cell":{"workbook","sheet","ref"},"from":"<qname>","to":"<qname>","rationale","confidence"}   re-tag an Excel cell
- {"op":"setScope","cell":{...},"to":"CY"|"PY","rationale","confidence"}                                  the cell is the other year
- {"op":"removeFact","fact":{"key","concept","scope"},"rationale","confidence"}
- {"op":"setText","fact":{...},"value":"<text, max 200 chars>","source":{"kind":"cell","cell":{...}}|{"kind":"user"},"rationale","confidence"}
SOURCE for an amount, exactly one of:
- {"kind":"cell","cell":{"workbook","sheet","ref"}}      an Excel cell of the bundle that shows this amount, in a column
                                                          of that year ("column":"CY"/"PY"); a column without a year
                                                          (e.g. "Note No.") never holds the amount
- {"kind":"identity","terms":[{"factKey","weight":1|-1}]}  value = sum of weight x those facts' values
- {"kind":"user"}                                         the amount is not in the data: the user must type it (value may be null)
Never invent an amount. When the Excel rows show the amount, use it (source "cell"); use setNil or a zero only when the
company really has no such amount, never to silence a rule. Never touch the company's identity data. Use only fact keys, cells and elements you were given
or found with the tools. If the right fix is unclear, return fewer patches and set needsHuman to true.

Answer with ONE JSON object and nothing else:
{"summary":"<one or two sentences>","patches":[...],"resolves":["<problem id>"],"needsHuman":false}"""

FINAL_NUDGE = "Stop calling tools. Answer now with the final JSON object only."
REPAIR_NUDGE = "Your answer was not the JSON object described. Reply with that JSON object only."
TOOL_NUDGE = "Your last tool call was invalid. Call a listed tool with valid JSON arguments, or answer with the final JSON object."
_JSON_BLOCK = re.compile(r"\{.*\}", re.S)


@dataclass
class AgentResult:
    summary: str
    patches: list[dict[str, Any]]
    dropped: list[dict[str, Any]]
    resolves: list[str]
    needs_human: bool
    steps: int
    usage: Usage
    tool_calls: list[dict[str, Any]] = field(default_factory=list)
    stop: str = "answered"  # answered | max-steps | token-budget | unparsable

    def to_json(self, model: str | None) -> dict[str, Any]:
        return {
            "summary": self.summary,
            "patches": self.patches,
            "dropped": self.dropped,
            "resolves": self.resolves,
            "needsHuman": self.needs_human,
            "steps": self.steps,
            "usage": self.usage.to_json(),
            "toolCalls": self.tool_calls,
            "stop": self.stop,
            "model": model,
        }


def user_message(bundle: FixRequest) -> str:
    data = bundle.model_dump(exclude_none=True, exclude={"options"})
    return json.dumps(data, separators=(",", ":"), ensure_ascii=False)


def run_agent(model: ChatModel, bundle: FixRequest, tools: FixTools | None = None) -> AgentResult:
    tools = tools or FixTools(bundle)
    max_steps, max_tokens = bundle.options.maxSteps, bundle.options.maxTokens
    messages: list[dict[str, Any]] = [{"role": "system", "content": SYSTEM_PROMPT}, {"role": "user", "content": user_message(bundle)}]
    usage = Usage()
    calls: list[dict[str, Any]] = []
    for step in range(1, max_steps + 1):
        last = step == max_steps or usage.total_tokens >= max_tokens * 0.8
        if last and messages[-1].get("content") != FINAL_NUDGE:
            messages.append({"role": "user", "content": FINAL_NUDGE})
        try:
            reply = model.chat(messages, tools=TOOL_SPECS, tool_choice="none" if last else "auto")
        except GroqError as exc:
            # Groq answers 400 tool_use_failed when the model emits a malformed tool call: tell it, try again
            if exc.status == 400 and "tool" in str(exc).lower() and step < max_steps:
                messages.append({"role": "user", "content": TOOL_NUDGE})
                continue
            raise
        usage.add(reply.usage)
        if reply.tool_calls and not last:
            messages.append({"role": "assistant", "content": reply.content or None, "tool_calls": reply.tool_calls})
            for tc in reply.tool_calls:
                fn = tc.get("function") or {}
                name, args = fn.get("name", ""), fn.get("arguments") or "{}"
                calls.append({"name": name, "arguments": _args_for_log(args)})
                messages.append({"role": "tool", "tool_call_id": tc.get("id", ""), "content": tools.call(name, args)})
            if usage.total_tokens >= max_tokens:
                return _give_up(step, usage, calls, "token-budget", "The AI used up its token budget before answering.")
            continue
        parsed = _parse(reply.content)
        if parsed is None:
            if step < max_steps:
                messages.append({"role": "assistant", "content": reply.content[:2000]})
                messages.append({"role": "user", "content": REPAIR_NUDGE})
                continue
            return _give_up(step, usage, calls, "unparsable", "The AI's answer could not be read.")
        raw = parsed.get("patches") if isinstance(parsed.get("patches"), list) else []
        kept, dropped = check_patches(raw, bundle, tools.known_concept)
        resolves = [r for r in parsed.get("resolves", []) if isinstance(r, str)][:20] if isinstance(parsed.get("resolves"), list) else []
        return AgentResult(
            summary=str(parsed.get("summary", ""))[:1000],
            patches=kept,
            dropped=dropped,
            resolves=resolves,
            needs_human=bool(parsed.get("needsHuman", False)) or not kept,
            steps=step,
            usage=usage,
            tool_calls=calls,
        )
    return _give_up(max_steps, usage, calls, "max-steps", "The AI did not answer within its step limit.")


def _give_up(steps: int, usage: Usage, calls: list[dict[str, Any]], stop: str, summary: str) -> AgentResult:
    return AgentResult(summary, [], [], [], True, steps, usage, calls, stop)


def _parse(text: str) -> dict[str, Any] | None:
    text = (text or "").strip()
    for candidate in (text, *(m.group(0) for m in [_JSON_BLOCK.search(text)] if m)):
        try:
            data = json.loads(candidate)
        except (json.JSONDecodeError, TypeError):
            continue
        if isinstance(data, dict):
            return data
    return None


def _args_for_log(args: Any) -> Any:
    if isinstance(args, str):
        try:
            return json.loads(args)
        except json.JSONDecodeError:
            return args[:300]
    return args
