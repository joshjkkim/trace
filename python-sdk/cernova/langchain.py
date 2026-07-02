"""LangChain callback handler for Cernova.

Attach to any LangChain LLM or chain — every LLM call is automatically traced:

    from cernova import Tracer
    from cernova.langchain import CernovaCallbackHandler

    tracer  = Tracer(api_key="trace_...")
    handler = CernovaCallbackHandler(tracer)

    llm   = ChatAnthropic(model="claude-haiku-4-5-20251001", callbacks=[handler])
    chain = prompt | llm | StrOutputParser()
    chain.invoke({"topic": "AI safety"})

Run grouping
------------
LangChain passes a `run_id` (UUID) to each LLM call and a `parent_run_id` for
the chain that contains it. We use the immediate parent as the Cernova run_id so
all LLM calls inside a single chain.invoke() share one run in the dashboard.

Step naming
-----------
Priority order:
  1. metadata["step_name"] passed in invoke() / run_config
  2. serialized["name"]  (e.g. "ChatAnthropic", "ChatOpenAI")
  3. "llm_call"

Thread safety
-------------
The handler can be shared across concurrent requests (threaded Flask, HTTPServer,
etc.). All per-call state is protected by a single RLock.
"""

from __future__ import annotations

import json
import threading
import time
from typing import Any
from uuid import UUID

try:
    from langchain_core.callbacks import BaseCallbackHandler
    from langchain_core.messages import BaseMessage
    from langchain_core.outputs import LLMResult
except ImportError as e:
    raise ImportError(
        "langchain-core is required: pip install cernova[langchain]"
    ) from e

from ._cost import get_cost
from .tracer import Tracer


def _extract_tokens_anthropic(llm_output: dict) -> tuple[int, int]:
    usage = llm_output.get("usage", {})
    inp = usage.get("input_tokens") or usage.get("prompt_tokens") or 0
    out = usage.get("output_tokens") or usage.get("completion_tokens") or 0
    return int(inp), int(out)


def _extract_tokens_openai(llm_output: dict) -> tuple[int, int]:
    usage = llm_output.get("token_usage", {})
    inp = usage.get("prompt_tokens") or 0
    out = usage.get("completion_tokens") or 0
    return int(inp), int(out)


def _extract_tokens(llm_output: dict) -> tuple[int, int]:
    inp, out = _extract_tokens_anthropic(llm_output)
    if inp or out:
        return inp, out
    return _extract_tokens_openai(llm_output)


def _extract_model(llm_output: dict, serialized: dict) -> str:
    return (
        llm_output.get("model")
        or llm_output.get("model_name")
        or llm_output.get("model_id")
        or (serialized.get("kwargs") or {}).get("model")
        or (serialized.get("kwargs") or {}).get("model_name")
        or serialized.get("name", "unknown")
    )


def _serialize_messages(messages: list[list[BaseMessage]]) -> str:
    out = []
    for batch in messages:
        for msg in batch:
            role = getattr(msg, "type", "unknown")
            role = {"human": "user", "ai": "assistant", "system": "system"}.get(role, role)
            content = msg.content if isinstance(msg.content, str) else json.dumps(msg.content)
            out.append({"role": role, "content": content})
    return json.dumps({"messages": out})


def _extract_output(response: LLMResult) -> str | None:
    try:
        gen = response.generations[0][0]
        if hasattr(gen, "message"):
            content = gen.message.content
            if isinstance(content, str):
                return content
            if isinstance(content, list):
                return " ".join(
                    b.get("text", "") for b in content if isinstance(b, dict) and b.get("type") == "text"
                )
        return getattr(gen, "text", None)
    except (IndexError, AttributeError):
        return None


class CernovaCallbackHandler(BaseCallbackHandler):
    """Attach to any LangChain LLM or chain to automatically trace every call."""

    def __init__(self, tracer: Tracer) -> None:
        super().__init__()
        self.tracer = tracer
        self._lock = threading.RLock()

        # run_id (LangChain UUID) → wall-clock start time
        self._start_times: dict[UUID, float] = {}
        # run_id → serialized dict (for model name extraction in on_llm_end)
        self._serialized: dict[UUID, dict] = {}
        # run_id → prompt string
        self._prompts: dict[UUID, str] = {}
        # run_id → step_name
        self._step_names: dict[UUID, str] = {}
        # trace_run_id (str) → step counter
        self._step_counters: dict[str, int] = {}

    # ── Helpers ───────────────────────────────────────────────────────────────

    def _trace_run_id(self, lc_run_id: UUID, parent_run_id: UUID | None) -> str:
        """Map LangChain's run hierarchy to a Cernova run_id.

        The immediate parent (chain's run_id) becomes the Cernova run_id so
        all LLM calls inside one chain.invoke() share a single run.
        If there's no parent (bare LLM call), the LLM's own run_id is used.
        """
        return str(parent_run_id) if parent_run_id else str(lc_run_id)

    def _next_step_index(self, trace_run_id: str) -> int:
        with self._lock:
            idx = self._step_counters.get(trace_run_id, 0)
            self._step_counters[trace_run_id] = idx + 1
        return idx

    def _step_name(self, run_id: UUID, serialized: dict, metadata: dict | None) -> str:
        if metadata and metadata.get("step_name"):
            return str(metadata["step_name"])
        return serialized.get("name") or "llm_call"

    def _pop_start(self, run_id: UUID) -> float | None:
        with self._lock:
            return self._start_times.pop(run_id, None)

    def _pop_state(self, run_id: UUID) -> tuple[dict, str, str]:
        with self._lock:
            serialized = self._serialized.pop(run_id, {})
            prompt     = self._prompts.pop(run_id, "")
            step_name  = self._step_names.pop(run_id, "llm_call")
        return serialized, prompt, step_name

    # ── LangChain callbacks ───────────────────────────────────────────────────

    def on_chat_model_start(
        self,
        serialized: dict[str, Any],
        messages: list[list[BaseMessage]],
        *,
        run_id: UUID,
        parent_run_id: UUID | None = None,
        metadata: dict[str, Any] | None = None,
        **kwargs: Any,
    ) -> None:
        with self._lock:
            self._start_times[run_id] = time.monotonic()
            self._serialized[run_id]  = serialized
            self._prompts[run_id]     = _serialize_messages(messages)
            self._step_names[run_id]  = self._step_name(run_id, serialized, metadata)

    def on_llm_start(
        self,
        serialized: dict[str, Any],
        prompts: list[str],
        *,
        run_id: UUID,
        parent_run_id: UUID | None = None,
        metadata: dict[str, Any] | None = None,
        **kwargs: Any,
    ) -> None:
        with self._lock:
            self._start_times[run_id] = time.monotonic()
            self._serialized[run_id]  = serialized
            self._prompts[run_id]     = json.dumps({"messages": [{"role": "user", "content": p} for p in prompts]})
            self._step_names[run_id]  = self._step_name(run_id, serialized, metadata)

    def on_llm_end(
        self,
        response: LLMResult,
        *,
        run_id: UUID,
        parent_run_id: UUID | None = None,
        **kwargs: Any,
    ) -> None:
        start = self._pop_start(run_id)
        latency_ms = int((time.monotonic() - start) * 1000) if start is not None else 0
        serialized, prompt, step_name = self._pop_state(run_id)

        llm_output            = response.llm_output or {}
        input_tok, output_tok = _extract_tokens(llm_output)
        total_tok  = input_tok + output_tok
        model      = _extract_model(llm_output, serialized)
        cost       = get_cost(model, input_tok, output_tok)
        output     = _extract_output(response)

        trace_run_id   = self._trace_run_id(run_id, parent_run_id)
        step_index     = self._next_step_index(trace_run_id)
        span_id        = str(run_id)
        parent_span_id = str(parent_run_id) if parent_run_id and str(parent_run_id) != trace_run_id else None

        self.tracer.ingest(
            run_id=trace_run_id,
            step_name=step_name,
            step_index=step_index,
            model=model,
            prompt=prompt,
            input_tokens=input_tok,
            output_tokens=output_tok,
            total_tokens=total_tok,
            latency_ms=latency_ms,
            cost=cost,
            status_success=True,
            output_code=output,
            span_id=span_id,
            parent_span_id=parent_span_id,
        )

    def on_llm_error(
        self,
        error: BaseException,
        *,
        run_id: UUID,
        parent_run_id: UUID | None = None,
        **kwargs: Any,
    ) -> None:
        start = self._pop_start(run_id)
        latency_ms = int((time.monotonic() - start) * 1000) if start is not None else 0
        serialized, prompt, step_name = self._pop_state(run_id)
        model = _extract_model({}, serialized)

        trace_run_id   = self._trace_run_id(run_id, parent_run_id)
        step_index     = self._next_step_index(trace_run_id)
        span_id        = str(run_id)
        parent_span_id = str(parent_run_id) if parent_run_id and str(parent_run_id) != trace_run_id else None

        self.tracer.ingest(
            run_id=trace_run_id,
            step_name=step_name,
            step_index=step_index,
            model=model,
            prompt=prompt,
            input_tokens=0,
            output_tokens=0,
            total_tokens=0,
            latency_ms=latency_ms,
            cost=0.0,
            status_success=False,
            error=str(error),
            span_id=span_id,
            parent_span_id=parent_span_id,
        )

    def on_chain_end(
        self,
        outputs: dict[str, Any],
        *,
        run_id: UUID,
        **kwargs: Any,
    ) -> None:
        with self._lock:
            self._step_counters.pop(str(run_id), None)
