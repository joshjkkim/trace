"""Core Tracer — fire-and-forget ingest + run context management."""

from __future__ import annotations

import json
import threading
import uuid as _uuid
from contextlib import contextmanager
from contextvars import ContextVar
from typing import Any, Generator
from urllib import request as _urllib_request

_DEFAULT_URL = "https://trace-production-940c.up.railway.app"

# ContextVar so run_id propagates automatically across async/threaded code
_active_run_id: ContextVar[str | None] = ContextVar("traceai_run_id", default=None)
_active_step_index: ContextVar[int] = ContextVar("traceai_step_index", default=0)


def _new_uuid() -> str:
    return str(_uuid.uuid4())


class Tracer:
    """
    trace.ai Python client.

    Usage::

        tracer = Tracer(api_key="trace_...")

        # Manual ingest (any framework)
        tracer.ingest(
            run_id="my-run",
            step_name="classify",
            step_index=0,
            model="claude-haiku-4-5-20251001",
            prompt=json.dumps({"messages": [...]}),
            input_tokens=12,
            output_tokens=4,
            total_tokens=16,
            latency_ms=84,
            status_success=True,
            output_code="billing",
        )

        # LangChain — see traceai.langchain.TraceAICallbackHandler
    """

    def __init__(self, api_key: str, api_url: str = "") -> None:
        self.api_key = api_key
        # Empty string falls back to default so that os.environ.get("TRACE_API_URL", "")
        # behaves the same as not passing api_url at all.
        self.api_url = (api_url or _DEFAULT_URL).rstrip("/")

    # ── Ingest ────────────────────────────────────────────────────────────────

    def ingest(self, **fields: Any) -> None:
        """Fire-and-forget POST to /ingest. Never raises — failures are silent."""
        threading.Thread(target=self._post, args=(fields,), daemon=True).start()

    def _post(self, payload: dict[str, Any]) -> None:
        try:
            data = json.dumps(payload).encode()
            req = _urllib_request.Request(
                f"{self.api_url}/ingest",
                data=data,
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {self.api_key}",
                },
                method="POST",
            )
            _urllib_request.urlopen(req, timeout=10)
        except Exception:
            pass  # never block the application

    # ── Run context ───────────────────────────────────────────────────────────

    @contextmanager
    def run(self, run_id: str | None = None) -> Generator["RunContext", None, None]:
        """Context manager that sets a run ID for the duration of a block.

        Use this when you're not using LangChain and want to group manual
        ingest() calls into a single run::

            with tracer.run() as run:
                tracer.ingest(run_id=run.run_id, step_name="step1", ...)
                tracer.ingest(run_id=run.run_id, step_name="step2", ...)
        """
        rid = run_id or _new_uuid()
        token_id  = _active_run_id.set(rid)
        token_idx = _active_step_index.set(0)
        ctx = RunContext(run_id=rid)
        try:
            yield ctx
        finally:
            _active_run_id.reset(token_id)
            _active_step_index.reset(token_idx)

    # ── Helpers for handlers ──────────────────────────────────────────────────

    def get_active_run_id(self) -> str | None:
        return _active_run_id.get()

    def next_step_index(self) -> int:
        idx = _active_step_index.get()
        _active_step_index.set(idx + 1)
        return idx


class RunContext:
    """Returned by Tracer.run() — holds the run_id for the current block."""

    def __init__(self, run_id: str) -> None:
        self.run_id = run_id
