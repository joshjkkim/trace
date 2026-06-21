from fastapi import APIRouter, HTTPException
from typing import List
from pydantic import BaseModel
from db import get_client

router = APIRouter(prefix="/calls", tags=["calls"])


class CallResponse(BaseModel):
    id: int
    step_name: str
    created_at: str
    model: str
    prompt: str | None = None
    input_tokens: int | None = None
    output_tokens: int | None = None
    reasoning_tokens: int | None = None
    total_tokens: int | None = None
    latency_ms: int | None = None
    cost: float | None = None
    status_success: bool | None = None
    error: str | None = None
    output_code: str | None = None
    run_id: str | None = None
    project_id: int | None = None


@router.get("/run/{run_id}", response_model=List[CallResponse])
def get_calls_by_run_id(run_id: str) -> List[CallResponse]:
    """Get all calls from a specific run_id."""
    try:
        client = get_client()
        res = client.table("CALLS").select("*").eq("run_id", run_id).execute()
        
        if not res.data:
            raise HTTPException(
                status_code=404,
                detail=f"No calls found for run_id: {run_id}"
            )
        
        return [CallResponse(**call) for call in res.data]
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/project/{project_id}", response_model=List[CallResponse])
def get_calls_by_project_id(project_id: int) -> List[CallResponse]:
    """Get all calls from a specific project_id."""
    try:
        client = get_client()
        res = client.table("CALLS").select("*").eq("project_id", project_id).execute()
        
        if not res.data:
            raise HTTPException(
                status_code=404,
                detail=f"No calls found for project_id: {project_id}"
            )
        
        return [CallResponse(**call) for call in res.data]
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
