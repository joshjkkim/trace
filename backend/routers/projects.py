from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Optional
from db import get_client
from services.slack_service import send_test_alert

router = APIRouter(prefix="/projects", tags=["projects"])


class ProjectCreate(BaseModel):
    owner: str
    API_KEY: str
    name: str


class ProjectResponse(BaseModel):
    id: str
    owner: str
    API_KEY: str
    created_at: str
    name: str
    slack_webhook_url: Optional[str] = None
    alert_on_error: Optional[bool] = True
    alert_error_rate_threshold: Optional[float] = 0.25
    alert_error_rate_window: Optional[int] = 20
    sentry_dsn: Optional[str] = None
    sentry_alert_level: Optional[str] = 'critical'
    slack_anomaly_level: Optional[str] = 'critical'
    threshold_mode: Optional[str] = 'dynamic'
    threshold_latency_ms: Optional[float] = None
    threshold_tokens: Optional[float] = None
    threshold_cost: Optional[float] = None
    monthly_budget_usd: Optional[float] = None


class WebhookUpdate(BaseModel):
    slack_webhook_url: Optional[str] = None
    alert_on_error: Optional[bool] = None
    alert_error_rate_threshold: Optional[float] = None
    alert_error_rate_window: Optional[int] = None
    sentry_dsn: Optional[str] = None
    sentry_alert_level: Optional[str] = None
    slack_anomaly_level: Optional[str] = None
    threshold_mode: Optional[str] = None
    threshold_latency_ms: Optional[float] = None
    threshold_tokens: Optional[float] = None
    threshold_cost: Optional[float] = None
    monthly_budget_usd: Optional[float] = None


class ProjectWithCallsResponse(ProjectResponse):
    call_count: int
    error_count: int = 0
    anomaly_count: int = 0
    last_active: Optional[str] = None


@router.post("/", response_model=ProjectResponse, status_code=201)
def create_project(project: ProjectCreate) -> ProjectResponse:
    """Create a new project and append its id to the owner's project_list."""
    try:
        client = get_client()
        res = client.table("PROJECTS").insert({
            "owner": project.owner,
            "API_KEY": project.API_KEY,
            "name": project.name,
        }).execute()

        if not res.data:
            raise HTTPException(status_code=400, detail="Failed to create project")

        project_id = res.data[0]["id"]

        profile_res = client.table("PROFILES").select("project_list").eq("id", project.owner).single().execute()
        current: list = profile_res.data.get("project_list") or []
        client.table("PROFILES").update({"project_list": current + [project_id]}).eq("id", project.owner).execute()

        return ProjectResponse(**res.data[0])
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/owner/{owner_id}", response_model=List[ProjectWithCallsResponse])
def list_projects_by_owner(owner_id: str) -> List[ProjectWithCallsResponse]:
    """List all projects owned by a specific user with call counts."""
    try:
        client = get_client()
        projects_res = client.table("PROJECTS").select("*").eq("owner", owner_id).execute()

        result = []
        for project in projects_res.data:
            pid = project["id"]
            calls_res = client.table("CALLS").select("id,status_success,created_at").eq("project_id", pid).order("created_at", desc=True).execute()
            rows = calls_res.data or []
            call_count = len(rows)
            error_count = sum(1 for r in rows if not r.get("status_success", True))
            last_active = rows[0]["created_at"] if rows else None
            anomaly_res = client.table("ANOMALIES").select("id", count="exact").eq("project_id", pid).execute()
            anomaly_count = len(anomaly_res.data or [])
            result.append(ProjectWithCallsResponse(
                **project,
                call_count=call_count,
                error_count=error_count,
                anomaly_count=anomaly_count,
                last_active=last_active,
            ))

        return result
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/", response_model=List[ProjectWithCallsResponse])
def list_projects() -> List[ProjectWithCallsResponse]:
    """List all projects with call counts."""
    try:
        client = get_client()
        
        # Get all projects
        projects_res = client.table("PROJECTS").select("*").execute()
        
        result = []
        for project in projects_res.data:
            # Count calls for this project
            calls_res = client.table("CALLS").select(
                "id", count="exact"
            ).eq("project_id", project["id"]).execute()
            
            result.append(ProjectWithCallsResponse(
                **project,
                call_count=len(calls_res.data)
            ))
        
        return result
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/{project_id}", response_model=ProjectResponse)
def get_project(project_id: str) -> ProjectResponse:
    """Get a specific project by ID."""
    try:
        client = get_client()
        res = client.table("PROJECTS").select("*").eq("id", project_id).execute()
        
        if not res.data:
            raise HTTPException(status_code=404, detail="Project not found")
        
        return ProjectResponse(**res.data[0])
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.put("/{project_id}", response_model=ProjectResponse)
def update_project(project_id: str, project: ProjectCreate) -> ProjectResponse:
    """Update a project."""
    try:
        client = get_client()
        res = client.table("PROJECTS").update({
            "email": project.email,
            "API_KEY": project.API_KEY,
            "name": project.name,
        }).eq("id", project_id).execute()
        
        if not res.data:
            raise HTTPException(status_code=404, detail="Project not found")
        
        return ProjectResponse(**res.data[0])
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.patch("/{project_id}/webhook", response_model=ProjectResponse)
def update_webhook(project_id: str, body: WebhookUpdate) -> ProjectResponse:
    """Save or clear the Slack webhook URL for a project."""
    try:
        client = get_client()
        updates: dict = {"slack_webhook_url": body.slack_webhook_url}
        if body.alert_on_error is not None:
            updates["alert_on_error"] = body.alert_on_error
        if body.alert_error_rate_threshold is not None:
            updates["alert_error_rate_threshold"] = body.alert_error_rate_threshold
        if body.alert_error_rate_window is not None:
            updates["alert_error_rate_window"] = body.alert_error_rate_window
        updates["sentry_dsn"] = body.sentry_dsn
        if body.sentry_alert_level is not None:
            updates["sentry_alert_level"] = body.sentry_alert_level
        if body.slack_anomaly_level is not None:
            updates["slack_anomaly_level"] = body.slack_anomaly_level
        if body.threshold_mode is not None:
            updates["threshold_mode"] = body.threshold_mode
        updates["threshold_latency_ms"] = body.threshold_latency_ms
        updates["threshold_tokens"] = body.threshold_tokens
        updates["threshold_cost"] = body.threshold_cost
        updates["monthly_budget_usd"] = body.monthly_budget_usd
        res = client.table("PROJECTS").update(updates).eq("id", project_id).execute()
        if not res.data:
            raise HTTPException(status_code=404, detail="Project not found")
        return ProjectResponse(**res.data[0])
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/{project_id}/webhook/test")
def test_webhook(project_id: str) -> dict:
    """Send a test ping to the project's configured Slack webhook."""
    try:
        client = get_client()
        res = client.table("PROJECTS").select("name,slack_webhook_url").eq("id", project_id).single().execute()
        if not res.data or not res.data.get("slack_webhook_url"):
            raise HTTPException(status_code=400, detail="No webhook configured")
        ok = send_test_alert(res.data["slack_webhook_url"], res.data["name"])
        if not ok:
            raise HTTPException(status_code=502, detail="Webhook delivery failed")
        return {"ok": True}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/{project_id}/usage")
def get_usage(project_id: str) -> dict:
    """Return usage/billing summary for a project."""
    try:
        from datetime import datetime, timezone
        db = get_client()
        now = datetime.now(timezone.utc)
        month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0).isoformat()

        res = db.table("USAGE").select("*").eq("project_id", project_id).order("created_at", desc=True).execute()
        rows = res.data or []

        month_rows = [r for r in rows if r["created_at"] >= month_start]
        month_cost = sum(r["cost_usd"] for r in month_rows)
        total_cost = sum(r["cost_usd"] for r in rows)

        by_feature: dict[str, float] = {}
        for r in month_rows:
            by_feature[r["feature"]] = by_feature.get(r["feature"], 0) + r["cost_usd"]

        proj = db.table("PROJECTS").select("monthly_budget_usd").eq("id", project_id).single().execute()
        budget = proj.data.get("monthly_budget_usd") if proj.data else None

        return {
            "month_cost_usd": round(month_cost, 6),
            "total_cost_usd": round(total_cost, 6),
            "budget_usd": budget,
            "budget_pct": round(month_cost / budget * 100, 1) if budget else None,
            "by_feature": {k: round(v, 6) for k, v in by_feature.items()},
            "recent": rows[:20],
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/{project_id}/thresholds")
def get_thresholds(project_id: str) -> dict:
    """Return current L4 anomaly thresholds for a project (dynamic or static)."""
    try:
        client = get_client()
        res = (
            client.table("CALLS")
            .select("latency_ms,total_tokens,cost")
            .eq("project_id", project_id)
            .order("created_at", desc=True)
            .limit(100)
            .execute()
        )
        rows = res.data or []
        call_count = len(rows)
        min_calls = 30

        static = {
            "latency_ms_max": 10000.0,
            "total_tokens_max": 50000.0,
            "cost_max": 1.0,
        }

        if call_count < min_calls:
            return {
                "mode": "static",
                "calls_used": call_count,
                "calls_needed": min_calls - call_count,
                "thresholds": static,
            }

        def percentile(values: list[float], p: float) -> float:
            sorted_vals = sorted(values)
            idx = (len(sorted_vals) - 1) * p
            lo, hi = int(idx), min(int(idx) + 1, len(sorted_vals) - 1)
            return sorted_vals[lo] + (sorted_vals[hi] - sorted_vals[lo]) * (idx - lo)

        def median(values: list[float]) -> float:
            return percentile(values, 0.5)

        latencies = [r["latency_ms"] for r in rows if r.get("latency_ms") is not None]
        tokens    = [r["total_tokens"] for r in rows if r.get("total_tokens") is not None]
        costs     = [r["cost"] for r in rows if r.get("cost") is not None]

        thresholds = dict(static)
        baselines  = {}

        if latencies:
            thresholds["latency_ms_max"] = round(max(3000.0, percentile(latencies, 0.95)), 1)
            baselines["latency_ms"] = {"p50": round(median(latencies), 1), "p95": round(percentile(latencies, 0.95), 1)}
        if tokens:
            thresholds["total_tokens_max"] = round(max(1000.0, percentile(tokens, 0.95)), 1)
            baselines["total_tokens"] = {"p50": round(median(tokens), 1), "p95": round(percentile(tokens, 0.95), 1)}
        if costs:
            thresholds["cost_max"] = round(max(0.05, percentile(costs, 0.95)), 6)
            baselines["cost"] = {"p50": round(median(costs), 6), "p95": round(percentile(costs, 0.95), 6)}

        return {
            "mode": "dynamic",
            "calls_used": call_count,
            "calls_needed": 0,
            "thresholds": thresholds,
            "baselines": baselines,
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/{project_id}/step-health")
def get_step_health(project_id: str) -> list[dict]:
    """Return trend health for every step profile in the project."""
    try:
        from services.trend_service import compute_project_health
        results = compute_project_health(project_id)
        return [
            {
                "step_profile_id": r.step_profile_id,
                "step_name": r.step_name,
                "status": r.status,
                "sample_count": r.sample_count,
                "trends": [
                    {
                        "metric": t.metric,
                        "baseline_mean": round(t.baseline_mean, 4),
                        "recent_mean": round(t.recent_mean, 4),
                        "sigma": t.sigma,
                        "direction": t.direction,
                    }
                    for t in r.trends
                ],
            }
            for r in results
        ]
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.delete("/{project_id}")
def delete_project(project_id: str) -> dict:
    """Delete a project"""
    try:
        client = get_client()
        res = client.table("PROJECTS").delete().eq("id", project_id).execute()
        
        if not res.data:
            raise HTTPException(status_code=404, detail="Project not found")
        
        return {"message": "Project deleted successfully"}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
