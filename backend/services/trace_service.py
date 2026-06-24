from datetime import datetime
from db import get_client
from schemas.trace import IngestPayload, TraceRecord, WorkflowRun, WorkflowMetrics


def ingest_trace(payload: IngestPayload) -> str:
    client = get_client()
    data = {
        "step_name":       payload.step_name,
        "model":           payload.model,
        "prompt":          payload.prompt,
        "input_tokens":    payload.input_tokens,
        "output_tokens":   payload.output_tokens,
        "reasoning_tokens": payload.reasoning_tokens,
        "total_tokens":    payload.total_tokens,
        "latency_ms":      payload.latency_ms,
        "cost":            payload.cost,
        "status_success":  payload.status_success,
        "error":           payload.error,
        "output_code":     payload.output_code,
        "run_id":          payload.run_id,
        "step_index":      payload.step_index,
        "project_id":      payload.project_id,
        "span_id":         payload.span_id,
        "parent_span_id":  payload.parent_span_id,
    }
    # Remove None values so Supabase uses column defaults
    data = {k: v for k, v in data.items() if v is not None}
    res = client.table("CALLS").insert(data).execute()
    return str(res.data[0]["id"])


def list_traces(limit: int = 100) -> list[TraceRecord]:
    client = get_client()
    res = (
        client.table("CALLS")
        .select("*")
        .order("created_at", desc=True)
        .limit(limit)
        .execute()
    )
    return [_row_to_trace(row) for row in res.data]


def get_trace(trace_id: str) -> TraceRecord | None:
    client = get_client()
    res = client.table("CALLS").select("*").eq("id", trace_id).execute()
    if not res.data:
        return None
    return _row_to_trace(res.data[0])


def get_workflow_run(run_id: str) -> WorkflowRun | None:
    """Fetch all traces for a workflow run and aggregate metrics."""
    client = get_client()
    res = (
        client.table("CALLS")
        .select("*")
        .eq("run_id", run_id)
        .order("created_at", desc=False)
        .execute()
    )
    
    if not res.data:
        return None
    
    rows = res.data
    steps = [_row_to_trace(row) for row in rows]
    
    # Compute aggregated metrics
    total_cost = sum(row.get("cost") or 0 for row in rows)
    total_tokens = sum(row.get("total_tokens") or 0 for row in rows)
    total_input_tokens = sum(row.get("input_tokens") or 0 for row in rows)
    total_output_tokens = sum(row.get("output_tokens") or 0 for row in rows)
    total_reasoning_tokens = sum(row.get("reasoning_tokens") or 0 for row in rows)
    total_latency_ms = sum(row.get("latency_ms") or 0 for row in rows)
    error_count = sum(1 for row in rows if not row.get("status_success", True))
    success_count = len(rows) - error_count
    step_count = len(rows)
    
    # Duration: from first created_at to last created_at
    created_times = []
    for row in rows:
        if row.get("created_at"):
            ct = row["created_at"]
            # Parse if it's a string (from Supabase)
            if isinstance(ct, str):
                ct = datetime.fromisoformat(ct.replace('Z', '+00:00'))
            created_times.append(ct)
    
    if created_times:
        created_times.sort()
        created_at = created_times[0]
        completed_at = created_times[-1]
        # Convert to milliseconds for duration
        duration_ms = int((completed_at - created_at).total_seconds() * 1000)
    else:
        created_at = rows[0]["created_at"]
        completed_at = rows[-1]["created_at"]
        duration_ms = 0
    
    metrics = WorkflowMetrics(
        total_cost=round(total_cost, 6),
        total_tokens=total_tokens,
        total_input_tokens=total_input_tokens,
        total_output_tokens=total_output_tokens,
        total_reasoning_tokens=total_reasoning_tokens,
        total_latency_ms=total_latency_ms,
        error_count=error_count,
        success_count=success_count,
        step_count=step_count,
        duration_ms=duration_ms,
    )
    
    project_id = rows[0].get("project_id")
    
    return WorkflowRun(
        run_id=run_id,
        project_id=project_id,
        steps=steps,
        metrics=metrics,
        created_at=created_at,
        completed_at=completed_at,
    )


def _row_to_trace(row: dict) -> TraceRecord:
    return TraceRecord(
        id=str(row["id"]),
        step_name=row.get("step_name"),
        created_at=row["created_at"],
        model=row.get("model"),
        prompt=row.get("prompt"),
        input_tokens=row.get("input_tokens"),
        output_tokens=row.get("output_tokens"),
        reasoning_tokens=row.get("reasoning_tokens"),
        total_tokens=row.get("total_tokens"),
        latency_ms=row.get("latency_ms"),
        cost=float(row["cost"]) if row.get("cost") is not None else None,
        status_success=row["status_success"],
        error=row.get("error"),
        output_code=row.get("output_code"),
        run_id=row["run_id"],
        step_index=row.get("step_index"),
        project_id=row.get("project_id"),
        span_id=row.get("span_id"),
        parent_span_id=row.get("parent_span_id"),
    )