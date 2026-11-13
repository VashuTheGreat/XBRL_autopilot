import sys
from langchain_core.messages import AIMessage, HumanMessage
from langchain_core.runnables import RunnableConfig
from langsmith import traceable

from src.core.exception import MyException
from src.core.logger import logger
from src.services.llm_provider.groq import get_llm
from ..models.state import AgentState
from ..prompts import RESPONDER_GENERAL_PROMPT, RESPONDER_RETREIVED_PROMPT

observe = traceable


@observe(name="responder_node", run_type="chain")
async def responder_node(state: AgentState, config: RunnableConfig | None = None):
    """The main node generating the AI response."""
    model = (config or {}).get("configurable", {}).get("model")
    llm = get_llm(model=model)

    conversation_history = state.get("messages") or []
    user_message = state.get("user_message", "")
    retreived_content = state.get("retreived_content")

    with logger.span("responder.execution", has_retrieved_content=bool(retreived_content)):
        try:
            if not retreived_content:
                logger.info("responder.generating_general", user_message=user_message)
                chain = RESPONDER_GENERAL_PROMPT | llm
                res = await chain.ainvoke(
                    input={"conversation_history": conversation_history, "user_message": user_message}
                )
                logger.info("responder.general_success")
                return {"messages": [HumanMessage(content=user_message), res], "ai_response": res.content if hasattr(res, "content") else str(res)}

            formatted_context = "".join(
                f"{i + 1}. {(x.get('page_content', str(x)) if isinstance(x, dict) else (x if isinstance(x, str) else getattr(x, 'page_content', str(x))))}\n"
                for i, x in enumerate(retreived_content)
            )
            logger.info("responder.generating_grounded", user_message=user_message, doc_count=len(retreived_content))
            chain = RESPONDER_RETREIVED_PROMPT | llm
            res = await chain.ainvoke(
                input={
                    "conversation_history": conversation_history,
                    "user_message": user_message,
                    "retreived_content": formatted_context,
                }
            )
            logger.info("responder.grounded_success")
            return {"messages": [HumanMessage(content=user_message), res], "ai_response": res.content if hasattr(res, "content") else str(res)}

        except Exception as e:
            logger.error("responder.failed", error=str(e))
            raise MyException(e, sys)
