from datetime import datetime

from pydantic import BaseModel, Field


# Matches CALLS columns (excluding auto-generated id, created_at).
class IngestPayload(BaseModel):
    step_name: str
    model: str
    prompt: str = Field(..., description="Exact user prompt string")
    input_tokens: int | None = None
    output_tokens: int | None = None
    reasoning_tokens: int | None = None
    total_tokens: int | None = None
    latency_ms: int
    cost: float | None = None
    status_success: bool = True
    error: str | None = None
    output_code: str | None = None
    run_id: str
    project_id: int | None = None


class IngestResponse(BaseModel):
    trace_id: str


# Matches CALLS row shape on read.
class TraceRecord(BaseModel):
    id: str
    step_name: str | None = None
    created_at: datetime
    model: str | None = None
    prompt: str | None = None
    input_tokens: int | None = None
    output_tokens: int | None = None
    reasoning_tokens: int | None = None
    total_tokens: int | None = None
    latency_ms: int | None = None
    cost: float | None = None
    status_success: bool
    error: str | None = None
    output_code: str | None = None
    run_id: str
    project_id: int | None = None
