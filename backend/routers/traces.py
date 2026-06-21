from fastapi import APIRouter, HTTPException, Query

from schemas.trace import TraceRecord, WorkflowRun
from services.trace_service import get_trace, list_traces, get_workflow_run

router = APIRouter(prefix="/traces", tags=["traces"])


@router.get("", response_model=list[TraceRecord])
def get_traces(limit: int = Query(default=100, ge=1, le=500)) -> list[TraceRecord]:
    return list_traces(limit=limit)


@router.get("/{trace_id}", response_model=TraceRecord)
def get_trace_by_id(trace_id: str) -> TraceRecord:
    trace = get_trace(trace_id)
    if trace is None:
        raise HTTPException(status_code=404, detail="Trace not found")
    return trace


# Runs router — view complete workflows by run_id
runs_router = APIRouter(prefix="/runs", tags=["runs"])


@runs_router.get("/{run_id}", response_model=WorkflowRun)
def get_run_by_id(run_id: str) -> WorkflowRun:
    """Fetch all traces for a workflow run with aggregated metrics."""
    workflow = get_workflow_run(run_id)
    if workflow is None:
        raise HTTPException(status_code=404, detail="Workflow run not found")
    return workflow
