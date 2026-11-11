"""AI fix proposals (docs/07-ai-fix-agent.md, ADR-0012). Stateless: the app sends one problem with its bundle; the
route answers with patches that nobody has applied. 409 ``ai.disabled`` without a Groq key; 422 ``privacy`` when the
bundle still carries identity data (nothing is sent to the LLM then)."""
from fastapi import APIRouter
from fastapi.concurrency import run_in_threadpool

from api.responses import error_response, success_response
from api.v1.schemas.fix import FixRequest
from src.core.logger import logger
from src.services.fix_agent.agent import run_agent
from src.services.fix_agent.privacy import PrivacyError, ensure_private
from src.services.llm.groq import GroqError, client_from_config

router = APIRouter()


@router.post("/propose")
async def propose_fix(body: FixRequest):
    try:
        ensure_private(body)
    except PrivacyError as exc:
        return error_response("The request carries identity data; nothing was sent to the AI.", status_code=422,
                              errors=[{"type": "privacy", "message": v} for v in exc.violations])
    try:
        client = client_from_config()
    except ValueError as exc:  # a GROQ_URL that is neither https nor loopback
        return error_response(str(exc), status_code=409, errors=[{"type": "ai.disabled", "message": str(exc)}])
    if client is None:
        return error_response("AI is off: no Groq API key.", status_code=409, errors=[{"type": "ai.disabled", "message": "no key"}])
    # ids and counts only: never amounts, labels or keys (docs/11 logs)
    with logger.span("fix.propose", taxonomy=body.taxonomy, code=body.problem.code, rule=body.problem.ruleId,
                     facts=len(body.facts), sources=len(body.sources)):
        try:
            result = await run_in_threadpool(run_agent, client, body)
        except GroqError as exc:
            return error_response(f"The AI service failed: {exc}", status_code=502, errors=[{"type": "ai.failed", "message": str(exc)}])
    return success_response(result.to_json(client.model), message=f"{len(result.patches)} patch(es) proposed")
