from functools import lru_cache
from typing import Any, Optional

from langgraph.graph import StateGraph, START, END
from langgraph.graph.state import CompiledStateGraph

from src.agents.models.state import AgentState
from src.agents.nodes.planner import planner_node
from src.agents.nodes.responder import responder_node
from src.agents.nodes.retreiver import retreived_node
from src.core.logger import logger
from src.services.memory.inmemory import get_checkpointer


def route_decision(state: AgentState) -> str:
    route = state.get("route_to", "responder")
    if route == "retriever":
        logger.info("graph.route", target="retriever")
        return "retriever"
    logger.info("graph.route", target="responder")
    return "responder"


def create_agent_graph(checkpointer: Any = None) -> CompiledStateGraph:
    builder = StateGraph(AgentState)

    builder.add_node("planner", planner_node)
    builder.add_node("retriever", retreived_node)
    builder.add_node("responder", responder_node)

    builder.add_edge(START, "planner")
    builder.add_conditional_edges(
        "planner",
        route_decision,
        {
            "retriever": "retriever",
            "responder": "responder",
        },
    )
    builder.add_edge("retriever", "responder")
    builder.add_edge("responder", END)

    cp = checkpointer if checkpointer is not None else get_checkpointer()
    return builder.compile(checkpointer=cp)


_cached_graph: Optional[CompiledStateGraph] = None


def get_graph(checkpointer: Any = None) -> CompiledStateGraph:
    global _cached_graph
    cp = checkpointer if checkpointer is not None else get_checkpointer()
    if _cached_graph is None:
        with logger.span("graph.compile", checkpointer_type=type(cp).__name__):
            logger.info("graph.compiling", checkpointer=type(cp).__name__)
            _cached_graph = create_agent_graph(checkpointer=cp)
            logger.info("graph.compiled_successfully")
    return _cached_graph
