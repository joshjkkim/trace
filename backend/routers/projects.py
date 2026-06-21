from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List
from db import get_client

router = APIRouter(prefix="/projects", tags=["projects"])


class ProjectCreate(BaseModel):
    owner: int
    API_KEY: str


class ProjectResponse(BaseModel):
    id: int
    owner: int
    API_KEY: str
    created_at: str


class ProjectWithCallsResponse(ProjectResponse):
    call_count: int


@router.post("/", response_model=ProjectResponse, status_code=201)
def create_project(project: ProjectCreate) -> ProjectResponse:
    """Create a new project."""
    try:
        client = get_client()
        res = client.table("PROJECTS").insert({
            "owner": project.owner,
            "API_KEY": project.API_KEY,
        }).execute()
        
        if not res.data:
            raise HTTPException(status_code=400, detail="Failed to create project")
        
        return ProjectResponse(**res.data[0])
    except HTTPException:
        raise
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
        }).eq("id", project_id).execute()
        
        if not res.data:
            raise HTTPException(status_code=404, detail="Project not found")
        
        return ProjectResponse(**res.data[0])
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
