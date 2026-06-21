import os
import sentry_sdk
from sentry_sdk.integrations.fastapi import FastApiIntegration
from sentry_sdk.integrations.starlette import StarletteIntegration
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from db import check_connection
from routers import ingest, traces, projects, calls, anomalies

sentry_sdk.init(
    dsn=os.environ.get("SENTRY_DSN"),
    integrations=[FastApiIntegration(), StarletteIntegration()],
    traces_sample_rate=1.0,
    send_default_pii=False,
)

app = FastAPI(title="Trace API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(ingest.router)
app.include_router(traces.router)
app.include_router(traces.runs_router)
app.include_router(projects.router)      # ADD THIS
app.include_router(calls.router)
app.include_router(anomalies.router)

@app.get("/debug-sentry")
def debug_sentry() -> dict:
    raise ValueError("Sentry test error from trace.ai backend")

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