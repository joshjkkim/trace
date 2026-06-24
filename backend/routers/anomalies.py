from fastapi import APIRouter, Request, HTTPException
from schemas.anomaly import AnomalyInput, AnomalyRecord
from services.anomaly_service import ingest_anomalies, get_anomalies_for_run, get_run_penalty_total, get_anomalies_for_project
from routers.ingest import _resolve_project
from anomaly import CONDITION_REGISTRY

router = APIRouter(prefix="/anomalies", tags=["anomalies"])


@router.post("/", response_model=list[AnomalyRecord], status_code=201)
def ingest(request: Request, items: list[AnomalyInput]) -> list[AnomalyRecord]:
    auth = request.headers.get("Authorization", "")
    api_key = auth.removeprefix("Bearer ").strip()
    project = _resolve_project(api_key) if api_key else None
    project_id = project["id"] if project else None

    return ingest_anomalies(items, project_id)


@router.get("/project/{project_id}", response_model=list[AnomalyRecord])
def get_for_project(project_id: str) -> list[AnomalyRecord]:
    return get_anomalies_for_project(project_id)


@router.get("/run/{run_id}", response_model=list[AnomalyRecord])
def get_for_run(run_id: str) -> list[AnomalyRecord]:
    return get_anomalies_for_run(run_id)


@router.get("/run/{run_id}/score")
def get_score(run_id: str) -> dict:
    return {"run_id": run_id, "total_penalty": get_run_penalty_total(run_id)}


@router.get("/registry")
def get_registry() -> dict:
    return {
        str(code): {
            "name": cond.name,
            "layer": cond.layer,
            "penalty": cond.penalty,
            "description": cond.description,
        }
        for code, cond in CONDITION_REGISTRY.items()
    }
