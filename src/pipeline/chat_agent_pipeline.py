import asyncio
import json
from typing import Any, AsyncGenerator, Dict, Optional

from langchain_core.messages import AIMessage, HumanMessage

from src.agents.graph import get_graph
from src.core.logger import logger
from src.guardrails.rails import guard
from src.services.llm_provider.groq import AVAILABLE_MODELS, DEFAULT_MODEL
from src.services.memory.inmemory import get_checkpointer
from .base import Pipeline


def _json_default(value: Any) -> Any:
    model_dump = getattr(value, "model_dump", None)
    if callable(model_dump):
        return model_dump(mode="json")
    return str(value)


class ChatPipeline(Pipeline):
    def __init__(self):
        self.graph = get_graph(get_checkpointer())

    @staticmethod
    async def stream_chat(
        message: str,
        thread_id: str,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> AsyncGenerator[str, None]:
        metadata = metadata or {}
        try:
            payload = json.dumps({
                "type": "node_flow",
                "node": "guardrail",
                "status": "running",
                "title": "Guardrails Invoked",
                "description": "Checking input safety, injection patterns and topic scope.",
            })
            yield f"data:{payload}\n\n"

            is_blocked, response = await asyncio.to_thread(guard, message)
            if is_blocked:
                payload = json.dumps({
                    "type": "node_flow",
                    "node": "guardrail",
                    "status": "blocked",
                    "title": "Guardrail Blocked",
                    "description": "Query blocked by security or domain policy.",
                })
                yield f"data:{payload}\n\n"
                yield f"data:{json.dumps({'type': 'blocked', 'message': response})}\n\n"
                return

            payload = json.dumps({
                "type": "node_flow",
                "node": "guardrail",
                "status": "completed",
                "title": "Guardrail Passed",
                "description": "Input verified and approved for processing.",
            })
            yield f"data:{payload}\n\n"

            logger.info("chat_pipeline.stream_chat_started", thread_id=thread_id)
            active_graph = get_graph(get_checkpointer())

            if active_graph is None:
                logger.error("chat_pipeline.graph_not_configured")
                err_payload = json.dumps({"type": "error", "message": "Graph engine not configured"})
                yield f"data:{err_payload}\n\n"
                return

            initial_state = {
                "user_message": message,
                "messages": [],
                "retreived_content": None,
                "queries": None,
            }
            model = metadata.get("model", DEFAULT_MODEL)
            if model not in AVAILABLE_MODELS:
                yield f"data:{json.dumps({'type': 'error', 'message': f'Unsupported model selection: {model}'})}\n\n"
                return

            config = {"configurable": {"thread_id": thread_id, "model": model}}

            async for event in active_graph.astream_events(initial_state, config=config, version="v2"):
                event_type = event.get("event")
                event_name = event.get("name")
                lg_node = event.get("metadata", {}).get("langgraph_node") or event_name

                match event_type:
                    case "on_chain_start" if lg_node in {"planner", "planner_node"}:
                        payload = json.dumps({
                            "type": "node_flow",
                            "node": "planner",
                            "status": "running",
                            "title": "Planner Invoked",
                            "description": "Analyzing intent and determining execution path.",
                        })
                        yield f"data:{payload}\n\n"

                    case "on_chain_end" if lg_node in {"planner", "planner_node"}:
                        out = event.get("data", {}).get("output", {})
                        route_to = out.get("route_to", "responder") if isinstance(out, dict) else "responder"
                        desc = "Routed to Knowledge Base Retriever" if route_to == "retriever" else "Direct LLM Responder selected"
                        payload = json.dumps({
                            "type": "node_flow",
                            "node": "planner",
                            "status": "completed",
                            "title": "Planner Decided",
                            "description": desc,
                        })
                        yield f"data:{payload}\n\n"

                    case "on_chain_start" if lg_node in {"retriever", "retriever_node"}:
                        tool_input = event.get("data", {}).get("input")
                        payload = json.dumps(
                            {"type": "tool_start", "tool": "retriever", "input": tool_input},
                            default=_json_default,
                        )
                        yield f"data:{payload}\n\n"
                        flow_payload = json.dumps({
                            "type": "node_flow",
                            "node": "retriever",
                            "status": "running",
                            "title": "Retriever Invoked",
                            "description": "Searching hybrid vector and keyword knowledge base.",
                        })
                        yield f"data:{flow_payload}\n\n"

                    case "on_chain_end" if lg_node in {"retriever", "retriever_node"}:
                        tool_output = str(event.get("data", {}).get("output"))
                        payload = json.dumps({"type": "tool_end", "tool": "retriever", "output": tool_output})
                        yield f"data:{payload}\n\n"
                        flow_payload = json.dumps({
                            "type": "node_flow",
                            "node": "retriever",
                            "status": "completed",
                            "title": "Retrieval Completed",
                            "description": "Relevant documents fetched and reranked.",
                        })
                        yield f"data:{flow_payload}\n\n"

                    case "on_chain_start" if lg_node in {"responder", "responder_node"}:
                        payload = json.dumps({
                            "type": "node_flow",
                            "node": "responder",
                            "status": "running",
                            "title": "Responder Invoked",
                            "description": "Generating answer.",
                        })
                        yield f"data:{payload}\n\n"

                    case "on_chat_model_stream":
                        langgraph_node = event.get("metadata", {}).get("langgraph_node")
                        if langgraph_node and langgraph_node not in {"chat_node", "agent_node", "responder", "responder_node"}:
                            continue

                        chunk = event.get("data", {}).get("chunk")
                        if chunk:
                            msg = getattr(chunk, "message", chunk)
                            additional_kwargs = getattr(msg, "additional_kwargs", {}) or getattr(chunk, "additional_kwargs", {})
                            reasoning = (
                                additional_kwargs.get("reasoning_content")
                                or additional_kwargs.get("reasoning")
                                or additional_kwargs.get("thinking")
                            )
                            if reasoning:
                                payload = json.dumps({"type": "reasoning", "content": reasoning})
                                yield f"data:{payload}\n\n"
                            else:
                                content = getattr(chunk, "content", None) or getattr(msg, "content", None)
                                if content:
                                    payload = json.dumps({"type": "token", "content": content})
                                    yield f"data:{payload}\n\n"

                    case "on_chain_end" if event.get("name") in {"chat_node", "agent_node", "responder", "responder_node"}:
                        output = event.get("data", {}).get("output", {})
                        ai_response = None
                        if isinstance(output, dict):
                            ai_response = output.get("ai_response")
                            if not ai_response:
                                msgs = output.get("messages", [])
                                if isinstance(msgs, list):
                                    for m in reversed(msgs):
                                        if isinstance(m, AIMessage) or getattr(m, "type", "") == "ai":
                                            ai_response = m.content
                                            break
                        if ai_response:
                            payload = json.dumps({"type": "final", "ai_response": ai_response, "state": "completed"})
                            yield f"data:{payload}\n\n"
                        flow_payload = json.dumps({
                            "type": "node_flow",
                            "node": "responder",
                            "status": "completed",
                            "title": "Responder Finished",
                            "description": "Answer generated successfully.",
                        })
                        yield f"data:{flow_payload}\n\n"

                    case _:
                        pass

            logger.info("chat_pipeline.stream_chat_completed", thread_id=thread_id)
        except Exception as e:
            logger.error("chat_pipeline.stream_chat_error", thread_id=thread_id, error=str(e))
            err_payload = json.dumps({"type": "error", "message": str(e)})
            yield f"data:{err_payload}\n\n"

    async def chat(
        self,
        message: str,
        thread_id: str,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Synchronously/direct execution for non-streaming calls."""
        metadata = metadata or {}
        model = metadata.get("model", DEFAULT_MODEL)
        active_graph = get_graph(get_checkpointer())
        config = {"configurable": {"thread_id": thread_id, "model": model}}
        initial_state = {
            "user_message": message,
            "messages": [],
            "retreived_content": None,
            "queries": None,
        }
        with logger.span("chat_pipeline.non_streaming", thread_id=thread_id):
            result = await active_graph.ainvoke(initial_state, config=config)
            ai_response = "No response generated"
            messages = result.get("messages", []) if isinstance(result, dict) else []
            for msg in reversed(messages):
                if isinstance(msg, AIMessage) or getattr(msg, "type", "") == "ai":
                    ai_response = msg.content
                    break
            if ai_response == "No response generated" and isinstance(result, dict) and "ai_response" in result:
                ai_response = result["ai_response"]

            retrieved_contexts = result.get("retreived_content", []) if isinstance(result, dict) else []
            retrieved_contexts = [
                context if isinstance(context, str) else getattr(context, "page_content", str(context))
                for context in (retrieved_contexts or [])
            ]
            return {
                "success": True,
                "response": ai_response,
                "data": {"retreived_content": retrieved_contexts},
            }

    async def initiate(self, message: str, thread_id: str, metadata: dict = {}) -> AsyncGenerator[str, None]:
        async for x in self.stream_chat(message, thread_id, metadata):
            yield x
