from fastapi import FastAPI, HTTPException
from db import check_connection
from routers import ingest, traces, projects, calls  # ADD THIS

app = FastAPI(title="Trace API", version="0.1.0")

app.include_router(ingest.router)
app.include_router(traces.router)
app.include_router(traces.runs_router)
app.include_router(projects.router)      # ADD THIS
app.include_router(calls.router)         # ADD THIS

@app.get("/health")
def health() -> dict:
    try:
        db = check_connection()
        return {"status": "ok", "database": "connected", **db}
    except Exception as exc:
        raise HTTPException(
            status_code=503,
            detail=f"Database connection failed: {exc}",
        ) from exc