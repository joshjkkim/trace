"""Smoke test — run with: python smoke_test.py

Tests:
  1. Tracer.ingest() fires without error (fire-and-forget, expects a running backend)
  2. Cost calculation
  3. TraceAICallbackHandler with a mock LLM (no real API call)
"""

import json
import sys
import uuid
from unittest.mock import MagicMock, patch
from uuid import UUID

sys.path.insert(0, ".")

from traceai import Tracer
from traceai._cost import get_cost
from traceai.langchain import (
    TraceAICallbackHandler,
    _extract_model,
    _extract_tokens,
    _serialize_messages,
)

# ── 1. Cost ──────────────────────────────────────────────────────────────────

assert get_cost("claude-haiku-4-5-20251001", 1_000_000, 1_000_000) == 4.8, "cost calc failed"
assert get_cost("gpt-4o", 500_000, 500_000) == 6.25, "cost calc failed"
assert get_cost("unknown-model", 1000, 1000) == 0.0, "unknown model should be 0"
print("✓ cost")

# ── 2. Token extraction ───────────────────────────────────────────────────────

anthropic_output = {"usage": {"input_tokens": 10, "output_tokens": 5}}
assert _extract_tokens(anthropic_output) == (10, 5), "anthropic token extraction failed"

openai_output = {"token_usage": {"prompt_tokens": 20, "completion_tokens": 8}}
assert _extract_tokens(openai_output) == (20, 8), "openai token extraction failed"
print("✓ token extraction")

# ── 3. Model extraction ───────────────────────────────────────────────────────

assert _extract_model({"model": "claude-haiku-4-5-20251001"}, {}) == "claude-haiku-4-5-20251001"
assert _extract_model({}, {"kwargs": {"model": "gpt-4o"}}) == "gpt-4o"
assert _extract_model({}, {"name": "ChatAnthropic"}) == "ChatAnthropic"
print("✓ model extraction")

# ── 4. Message serialization ──────────────────────────────────────────────────

msg1 = MagicMock()
msg1.type = "system"
msg1.content = "You are a helpful assistant."

msg2 = MagicMock()
msg2.type = "human"
msg2.content = "What is 2+2?"

serialized = json.loads(_serialize_messages([[msg1, msg2]]))
assert serialized["messages"][0] == {"role": "system", "content": "You are a helpful assistant."}
assert serialized["messages"][1] == {"role": "user", "content": "What is 2+2?"}
print("✓ message serialization")

# ── 5. Callback handler — ingest payload shape ────────────────────────────────

tracer = Tracer(api_key="trace_test", api_url="http://localhost:9999")
handler = TraceAICallbackHandler(tracer)

ingested = []
tracer.ingest = lambda **kw: ingested.append(kw)  # capture instead of posting

run_id = UUID("11111111-1111-1111-1111-111111111111")
parent_id = UUID("22222222-2222-2222-2222-222222222222")
serialized_llm = {"name": "ChatAnthropic", "kwargs": {"model": "claude-haiku-4-5-20251001"}}

# Simulate on_chat_model_start
handler.on_chat_model_start(
    serialized_llm, [[msg1, msg2]],
    run_id=run_id, parent_run_id=parent_id, metadata={"step_name": "classify"},
)

# Simulate on_llm_end
from langchain_core.outputs import LLMResult, ChatGeneration
from langchain_core.messages import AIMessage

ai_msg = AIMessage(content="The answer is 4.")
gen = ChatGeneration(message=ai_msg)
result = LLMResult(
    generations=[[gen]],
    llm_output={"model": "claude-haiku-4-5-20251001", "usage": {"input_tokens": 12, "output_tokens": 7}},
)
handler.on_llm_end(result, run_id=run_id, parent_run_id=parent_id)

assert len(ingested) == 1, f"expected 1 ingest call, got {len(ingested)}"
payload = ingested[0]
assert payload["run_id"] == str(parent_id), f"run_id should be parent: {payload['run_id']}"
assert payload["step_name"] == "classify", f"step_name: {payload['step_name']}"
assert payload["step_index"] == 0
assert payload["model"] == "claude-haiku-4-5-20251001"
assert payload["input_tokens"] == 12
assert payload["output_tokens"] == 7
assert payload["total_tokens"] == 19
assert payload["status_success"] is True
assert payload["output_code"] == "The answer is 4."
print("✓ callback handler — ingest payload")

# ── 6. Error path ─────────────────────────────────────────────────────────────

run_id2 = UUID("33333333-3333-3333-3333-333333333333")
handler.on_chat_model_start(serialized_llm, [[msg1]], run_id=run_id2, parent_run_id=None)
handler.on_llm_error(ValueError("rate limit"), run_id=run_id2, parent_run_id=None)

err_payload = ingested[-1]
assert err_payload["run_id"] == str(run_id2)   # no parent → use own run_id
assert err_payload["status_success"] is False
assert "rate limit" in err_payload["error"]
print("✓ callback handler — error path")

print("\nAll smoke tests passed.")
