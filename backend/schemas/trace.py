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
    step_index: int | None = None
    project_id: str | None = None
    span_id: str | None = None
    parent_span_id: str | None = None


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
    step_index: int | None = None
    project_id: str | None = None
    span_id: str | None = None
    parent_span_id: str | None = None


# Aggregated metrics for a workflow run
class WorkflowMetrics(BaseModel):
    total_cost: float
    total_tokens: int
    total_input_tokens: int
    total_output_tokens: int
    total_reasoning_tokens: int
    total_latency_ms: int
    error_count: int
    success_count: int
    step_count: int
    duration_ms: int  # earliest start to latest end


# Complete workflow run with all steps and metrics
class WorkflowRun(BaseModel):
    run_id: str
    project_id: str | None = None
    steps: list[TraceRecord]
    metrics: WorkflowMetrics
    created_at: datetime  # earliest step
    completed_at: datetime  # latest step
