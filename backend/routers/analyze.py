import os
import anthropic
from fastapi import APIRouter, HTTPException
from db import get_client
from services.anomaly_service import get_anomalies_for_run
from anomaly import CONDITION_REGISTRY

router = APIRouter(prefix="/analyze", tags=["analyze"])

_MODEL = "claude-sonnet-4-6"
_INPUT_COST_PER_TOKEN  = 3.0  / 1_000_000   # $3/1M input tokens
_OUTPUT_COST_PER_TOKEN = 15.0 / 1_000_000   # $15/1M output tokens

_PROMPT = """\
You are an expert AI observability engineer analyzing a traced AI workflow run for anomalies.

Run ID: {run_id}
Project: {project_name}

## Steps (in order)
{steps}

## Anomalies detected
{anomalies}

Respond in this exact structure:

**Summary**
2-3 sentences describing what happened in this run and whether it's concerning.

**Root Cause**
The most likely explanation for the anomalies detected, tied specifically to the step names and error types shown.

**Recommendations**
- Bullet point 1
- Bullet point 2
- Bullet point 3

Be specific. Reference step names and condition codes directly."""


def _build_steps_text(calls: list[dict]) -> str:
    if not calls:
        return "(no steps recorded)"
    lines = []
    for c in calls:
        status = "OK" if c.get("status_success") else f"ERROR: {c.get('error') or 'unknown'}"
        lines.append(
            f"  [{c.get('step_index', '?')}] {c.get('step_name', 'unknown')} — "
            f"model={c.get('model','?')} latency={c.get('latency_ms','?')}ms "
            f"tokens={c.get('total_tokens','?')} cost=${c.get('cost', 0):.4f} {status}"
        )
    return "\n".join(lines)


def _build_anomaly_text(anomalies: list) -> str:
    if not anomalies:
        return "(none)"
    by_step: dict[str, list] = {}
    for a in anomalies:
        by_step.setdefault(a.step_name, []).append(a)
    lines = []
    for step_name, rows in by_step.items():
        details = []
        for row in rows:
            cond = CONDITION_REGISTRY.get(row.error_code)
            name = cond.name if cond else str(row.error_code)
            desc = cond.description if cond else ""
            details.append(f"{row.error_code} {name} (+{row.penalty_score}pts) — {desc}")
        lines.append(f"  step '{step_name}': " + "; ".join(details))
    return "\n".join(lines)


def _record_usage(project_id: str | None, run_id: str, input_tokens: int, output_tokens: int, cost: float) -> None:
    try:
        get_client().table("USAGE").insert({
            "project_id": project_id,
            "run_id": run_id,
            "feature": "analyze_run",
            "model": _MODEL,
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "cost_usd": cost,
        }).execute()
        if project_id:
            _check_budget(project_id, cost)
    except Exception as exc:
        print(f"[analyze] usage record failed: {exc}")


def _check_budget(project_id: str, just_spent: float) -> None:
    try:
        db = get_client()
        proj = db.table("PROJECTS").select("name,monthly_budget_usd,slack_webhook_url").eq("id", project_id).single().execute()
        if not proj.data:
            return
        budget = proj.data.get("monthly_budget_usd")
        webhook = proj.data.get("slack_webhook_url")
        if not budget or not webhook:
            return

        from datetime import datetime, timezone
        now = datetime.now(timezone.utc)
        month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0).isoformat()
        res = db.table("USAGE").select("cost_usd").eq("project_id", project_id).gte("created_at", month_start).execute()
        total = sum(r["cost_usd"] for r in (res.data or []))

        if total >= budget:
            from services.slack_service import send_budget_alert
            send_budget_alert(
                webhook_url=webhook,
                project_name=proj.data.get("name", "unknown"),
                project_id=project_id,
                spent_usd=total,
                budget_usd=budget,
            )
    except Exception as exc:
        print(f"[analyze] budget check failed: {exc}")


@router.post("/run/{run_id}")
def analyze_run(run_id: str) -> dict:
    db = get_client()

    calls_res = db.table("CALLS").select("*").eq("run_id", run_id).order("step_index").execute()
    if not calls_res.data:
        raise HTTPException(status_code=404, detail="Run not found")

    project_id: str | None = calls_res.data[0].get("project_id")
    project_name = "unknown"
    if project_id:
        proj = db.table("PROJECTS").select("name").eq("id", project_id).single().execute()
        project_name = proj.data.get("name", "unknown") if proj.data else "unknown"

    anomalies = get_anomalies_for_run(run_id)
    steps_text   = _build_steps_text(calls_res.data)
    anomaly_text = _build_anomaly_text(anomalies)

    client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
    response = client.messages.create(
        model=_MODEL,
        max_tokens=800,
        messages=[{
            "role": "user",
            "content": _PROMPT.format(
                run_id=run_id,
                project_name=project_name,
                steps=steps_text,
                anomalies=anomaly_text,
            ),
        }],
    )

    analysis = response.content[0].text
    in_tok   = response.usage.input_tokens
    out_tok  = response.usage.output_tokens
    cost     = in_tok * _INPUT_COST_PER_TOKEN + out_tok * _OUTPUT_COST_PER_TOKEN

    _record_usage(project_id, run_id, in_tok, out_tok, cost)

    return {
        "analysis": analysis,
        "model": _MODEL,
        "input_tokens": in_tok,
        "output_tokens": out_tok,
        "cost_usd": round(cost, 6),
    }
