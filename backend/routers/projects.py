from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Optional
from db import get_client
from services.slack_service import send_test_alert

router = APIRouter(prefix="/projects", tags=["projects"])


class ProjectCreate(BaseModel):
    owner: int
    API_KEY: str
    name: str


class ProjectResponse(BaseModel):
    id: int
    owner: int
    API_KEY: str
    created_at: str
    name: str
    slack_webhook_url: Optional[str] = None
    alert_on_error: Optional[bool] = True
    alert_error_rate_threshold: Optional[float] = 0.25
    alert_error_rate_window: Optional[int] = 20
    sentry_dsn: Optional[str] = None
    sentry_alert_level: Optional[str] = 'critical'


class WebhookUpdate(BaseModel):
    slack_webhook_url: Optional[str] = None
    alert_on_error: Optional[bool] = None
    alert_error_rate_threshold: Optional[float] = None
    alert_error_rate_window: Optional[int] = None
    sentry_dsn: Optional[str] = None
    sentry_alert_level: Optional[str] = None


class ProjectWithCallsResponse(ProjectResponse):
    call_count: int


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
def list_projects_by_owner(owner_id: int) -> List[ProjectWithCallsResponse]:
    """List all projects owned by a specific user with call counts."""
    try:
        client = get_client()
        projects_res = client.table("PROJECTS").select("*").eq("owner", owner_id).execute()

        result = []
        for project in projects_res.data:
            calls_res = client.table("CALLS").select("id", count="exact").eq("project_id", project["id"]).execute()
            result.append(ProjectWithCallsResponse(**project, call_count=len(calls_res.data)))

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
def get_project(project_id: int) -> ProjectResponse:
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
def update_project(project_id: int, project: ProjectCreate) -> ProjectResponse:
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
def update_webhook(project_id: int, body: WebhookUpdate) -> ProjectResponse:
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
        res = client.table("PROJECTS").update(updates).eq("id", project_id).execute()
        if not res.data:
            raise HTTPException(status_code=404, detail="Project not found")
        return ProjectResponse(**res.data[0])
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/{project_id}/webhook/test")
def test_webhook(project_id: int) -> dict:
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


@router.delete("/{project_id}")
def delete_project(project_id: int) -> dict:
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
