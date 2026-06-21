import json
import threading
from fastapi import APIRouter, Request, HTTPException
import sentry_sdk
from sentry_sdk import Client as SentryClient, Scope

from schemas.trace import IngestPayload, IngestResponse
from services.trace_service import ingest_trace
from services.slack_service import (
    send_error_alert, send_rate_alert, send_anomaly_alert,
    RATE_THRESHOLD, RATE_WINDOW,
)
from services.anomaly_service import ingest_anomalies
from anomaly import evaluate_call, CallInput
from db import get_client

router = APIRouter(tags=["ingest"])


def _resolve_project(api_key: str) -> dict | None:
    """Return project row for the given API key, or None."""
    try:
        res = (
            get_client()
            .table("PROJECTS")
            .select("*")
            .eq("API_KEY", api_key)
            .maybe_single()
            .execute()
        )
        if not res.data:
            print(f"[ingest] no project found for key {api_key[:12]}…")
        return res.data if res.data else None
    except Exception as exc:
        print(f"[ingest] _resolve_project error for key {api_key[:12]}…: {exc}")
        return None


def _fire_slack(project: dict, payload: IngestPayload) -> None:
    """Run in a background thread so it never blocks the ingest response."""
    webhook = project.get("slack_webhook_url")
    if not webhook:
        return

    name = project.get("name", "Unknown")
    pid  = project["id"]

    alert_on_error     = project.get("alert_on_error", True)
    rate_threshold     = project.get("alert_error_rate_threshold") or 0.25
    rate_window        = project.get("alert_error_rate_window") or 20

    # Individual error alert
    if payload.status_success is False and alert_on_error:
        send_error_alert(
            webhook_url=webhook,
            project_name=name,
            project_id=pid,
            step_name=payload.step_name,
            model=payload.model,
            error=payload.error or "Unknown error",
            run_id=payload.run_id,
        )

    # Error rate check
    try:
        res = (
            get_client()
            .table("CALLS")
            .select("status_success")
            .eq("project_id", pid)
            .order("created_at", desc=True)
            .limit(rate_window)
            .execute()
        )
        rows = res.data or []
        if len(rows) >= 5:
            errors = sum(1 for r in rows if not r.get("status_success", True))
            rate = errors / len(rows)
            if rate >= rate_threshold:
                send_rate_alert(webhook, name, pid, rate, len(rows))
    except Exception as exc:
        print(f"[ingest] error rate check failed: {exc}")


def _fire_user_sentry(dsn: str, payload: IngestPayload, result, project_name: str) -> None:
    """Send an anomaly event to the user's own Sentry project."""
    try:
        user_client = SentryClient(dsn=dsn, default_integrations=False)
        codes_summary = ", ".join(
            f"{code}+{int(pts)}pts" for code, pts in result.error_map.items()
        )
        scope = Scope()
        scope.set_tag("trace_ai.project", project_name)
        scope.set_tag("trace_ai.step", payload.step_name)
        scope.set_tag("trace_ai.model", payload.model)
        scope.set_tag("trace_ai.layer", str(result.stopped_at_layer))
        scope.set_extra("run_id", payload.run_id)
        scope.set_extra("total_score", result.total_score)
        scope.set_extra("threshold", result.threshold)
        scope.set_extra("error_map", dict(result.error_map))
        scope.fingerprint = ["trace-ai", "anomaly", payload.step_name or "unknown"]
        level = "error" if result.triggered else "warning"
        event_id = user_client.capture_event(
            {
                "message": f"[trace.ai] {'Critical anomaly' if result.triggered else 'Anomaly warning'} in '{payload.step_name}' — {result.total_score}pts ({codes_summary})",
                "level": level,
            },
            scope=scope,
        )
        flushed = user_client.flush(timeout=5)
        print(f"[sentry] event_id={event_id} flushed={flushed} step={payload.step_name} score={result.total_score} level={level}")
    except Exception as exc:
        print(f"[ingest] user sentry fire failed: {exc}")


def _extract_instruction(prompt: str) -> str:
    """If the prompt is SDK-format JSON {system, messages}, return the readable instruction text.
    Prevents JSON wrapper keys/words from confusing L2/L3 format checks."""
    try:
        obj = json.loads(prompt)
        if isinstance(obj, dict) and "messages" in obj:
            parts = []
            if obj.get("system"):
                parts.append(str(obj["system"]))
            for msg in obj.get("messages", []):
                if isinstance(msg, dict) and msg.get("role") == "user":
                    parts.append(str(msg.get("content", "")))
            return "\n".join(parts)
    except (ValueError, TypeError):
        pass
    return prompt


def _dynamic_l4_limits(project_id: int) -> dict[str, float] | None:
    """Compute per-project L4 limits from recent call history (mean + 2σ).
    Returns None when fewer than 30 calls exist — caller falls back to static."""
    try:
        res = (
            get_client()
            .table("CALLS")
            .select("latency_ms,total_tokens,cost")
            .eq("project_id", project_id)
            .order("created_at", desc=True)
            .limit(100)
            .execute()
        )
        rows = res.data or []
        if len(rows) < 30:
            return None

        def stats(values: list[float]) -> tuple[float, float]:
            n = len(values)
            mean = sum(values) / n
            stddev = (sum((v - mean) ** 2 for v in values) / n) ** 0.5
            return mean, stddev

        latencies = [r["latency_ms"] for r in rows if r.get("latency_ms") is not None]
        tokens    = [r["total_tokens"] for r in rows if r.get("total_tokens") is not None]
        costs     = [r["cost"] for r in rows if r.get("cost") is not None]

        limits: dict[str, float] = {}
        if latencies:
            m, s = stats(latencies)
            limits["latency_ms_max"] = max(3000.0, m + 2 * s)
        if tokens:
            m, s = stats(tokens)
            limits["total_tokens_max"] = max(1000.0, m + 2 * s)
        if costs:
            m, s = stats(costs)
            limits["cost_max"] = max(0.05, m + 2 * s)

        return limits or None
    except Exception as exc:
        print(f"[anomaly] dynamic limits failed: {exc}")
        return None


def _run_anomaly_detection(payload: IngestPayload, project: dict | None) -> None:
    """Run in a background thread — score the call and persist any anomalies."""
    try:
        from anomaly.config import EvalConfig
        call_input = CallInput.model_validate(
            {**payload.model_dump(), "prompt": _extract_instruction(payload.prompt)}
        )
        config = EvalConfig()
        if project:
            mode = project.get("threshold_mode", "dynamic")
            if mode == "manual":
                overrides: dict[str, float] = {}
                if project.get("threshold_latency_ms") is not None:
                    overrides["latency_ms_max"] = project["threshold_latency_ms"]
                if project.get("threshold_tokens") is not None:
                    overrides["total_tokens_max"] = project["threshold_tokens"]
                if project.get("threshold_cost") is not None:
                    overrides["cost_max"] = project["threshold_cost"]
                if overrides:
                    config = EvalConfig(limits={**config.limits, **overrides})
                    print(f"[anomaly] manual L4 limits for project {project['id']}: {overrides}")
            else:
                dynamic = _dynamic_l4_limits(project["id"])
                if dynamic:
                    config = EvalConfig(limits={**config.limits, **dynamic})
                    print(f"[anomaly] dynamic L4 limits for project {project['id']}: {dynamic}")
        result = evaluate_call(call_input, config)
        print(f"[anomaly] run={payload.run_id} step={payload.step_name} score={result.total_score} triggered={result.triggered} layer={result.stopped_at_layer} codes={dict(result.error_map)}")
        if result.error_map:
            from schemas.anomaly import AnomalyInput
            ingest_anomalies(
                [AnomalyInput(
                    step_name=payload.step_name,
                    run_id=payload.run_id,
                    bad_scores={str(code): int(penalty) for code, penalty in result.error_map.items()},
                )],
                project["id"] if project else None,
            )

            dsn = project.get("sentry_dsn") if project else None
            level = (project.get("sentry_alert_level") or "critical") if project else "critical"
            if dsn and level != "none":
                if level == "warning" or result.triggered:
                    _fire_user_sentry(dsn, payload, result, project.get("name", "unknown"))

            webhook = project.get("slack_webhook_url") if project else None
            slack_level = (project.get("slack_anomaly_level") or "critical") if project else "critical"
            if webhook and slack_level != "none":
                if slack_level == "warning" or result.triggered:
                    from anomaly import CONDITION_REGISTRY
                    condition_names = {
                        code: (CONDITION_REGISTRY[code].name if code in CONDITION_REGISTRY else "")
                        for code in result.error_map
                    }
                    send_anomaly_alert(
                        webhook_url=webhook,
                        project_name=project.get("name", "unknown"),
                        project_id=project["id"],
                        step_name=payload.step_name,
                        run_id=payload.run_id,
                        total_score=result.total_score,
                        error_map=dict(result.error_map),
                        condition_names=condition_names,
                        triggered=result.triggered,
                    )
    except Exception as exc:
        print(f"[ingest] anomaly detection failed for run {payload.run_id}: {exc}")


@router.post("/ingest", response_model=IngestResponse)
def ingest(request: Request, payload: IngestPayload) -> IngestResponse:
    auth = request.headers.get("Authorization", "")
    api_key = auth.removeprefix("Bearer ").strip()

    if not api_key:
        raise HTTPException(status_code=401, detail="Missing API key")

    project = _resolve_project(api_key)
    payload.project_id = project["id"] if project else None

    trace_id = ingest_trace(payload)

    threading.Thread(target=_run_anomaly_detection, args=(payload, project), daemon=True).start()

    if project:
        threading.Thread(target=_fire_slack, args=(project, payload), daemon=True).start()

    return IngestResponse(trace_id=trace_id)
