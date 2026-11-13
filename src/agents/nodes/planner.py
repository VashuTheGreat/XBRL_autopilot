import sys
from langchain_core.runnables import RunnableConfig
from langsmith import traceable

from src.core.exception import MyException
from src.core.logger import logger
from src.services.llm_provider.groq import get_llm
from ..models.state import AgentState
from ..models.structure import PlannerStructure
from ..prompts import PLANNER_PROMPT

observe = traceable


@observe(name="planner_node", run_type="chain")
async def planner_node(state: AgentState, config: RunnableConfig | None = None):
    """Plan the routing process and generate queries if retriever node is chosen."""
    model = (config or {}).get("configurable", {}).get("model")
    llm = get_llm(model=model)
    user_message = state.get("user_message", "")

    with logger.span("planner.execution", user_message=user_message):
        try:
            logger.info("planner.planning_route", user_message=user_message)
            conversation_history = state.get("messages") or []
            chain = PLANNER_PROMPT | llm.with_structured_output(PlannerStructure)

            res = await chain.ainvoke(
                input={"conversation_history": conversation_history, "user_message": user_message}
            )

            route_to = getattr(res, "route_to", "responder")
            queries = getattr(res, "queries", None)

            logger.info("planner.decision", route_to=route_to, queries=queries)
            return {"route_to": route_to, "queries": queries}
        except Exception as e:
            logger.error("planner.failed", error=str(e))
            raise MyException(e, sys)
