from db import get_client
from schemas.anomaly import AnomalyInput, AnomalyRecord


def ingest_anomalies(items: list[AnomalyInput], project_id: str | None) -> list[AnomalyRecord]:
    """Normalize bad_scores dict into individual rows and insert them all."""
    client = get_client()
    rows = []
    for item in items:
        for code_str, score in item.bad_scores.items():
            rows.append({
                "step_name":     item.step_name,
                "run_id":        item.run_id,
                "project_id":    project_id,
                "error_code":    int(code_str),
                "penalty_score": score,
            })

    if not rows:
        return []

    res = client.table("ANOMALIES").insert(rows).execute()
    return [AnomalyRecord(**r) for r in res.data]


def get_anomalies_for_run(run_id: str) -> list[AnomalyRecord]:
    res = (
        get_client()
        .table("ANOMALIES")
        .select("*")
        .eq("run_id", run_id)
        .order("created_at")
        .execute()
    )
    return [AnomalyRecord(**r) for r in res.data]


def get_anomalies_for_project(project_id: str) -> list[AnomalyRecord]:
    res = (
        get_client()
        .table("ANOMALIES")
        .select("*")
        .eq("project_id", project_id)
        .order("created_at", desc=True)
        .execute()
    )
    return [AnomalyRecord(**r) for r in res.data]


def get_run_penalty_total(run_id: str) -> int:
    res = (
        get_client()
        .table("ANOMALIES")
        .select("penalty_score")
        .eq("run_id", run_id)
        .execute()
    )
    return sum(r["penalty_score"] for r in res.data)
