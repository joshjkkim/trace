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


def _fire_user_sentry_performance(
    dsn: str, payload: IngestPayload, anomaly_score: float, triggered: bool, project_name: str
) -> None:
    """Send a Sentry Performance transaction for every LLM call — not just anomalous ones.
    Steps in the same run share a trace_id so Sentry can reconstruct the full pipeline."""
    try:
        import datetime, uuid as _uuid

        user_client = SentryClient(dsn=dsn, traces_sample_rate=1.0, default_integrations=False)

        now   = datetime.datetime.now(datetime.timezone.utc)
        start = now - datetime.timedelta(milliseconds=payload.latency_ms or 0)

        # Deterministic trace_id from run_id so all steps in a run share the same trace
        trace_id   = _uuid.uuid5(_uuid.NAMESPACE_URL, f"trace-ai:{payload.run_id}").hex  # 32 hex
        span_id    = _uuid.uuid4().hex[:16]
        child_span = _uuid.uuid4().hex[:16]
        status     = "ok" if payload.status_success else "internal_error"

        event = {
            "type": "transaction",
            "transaction": payload.step_name or "unknown_step",
            "transaction_info": {"source": "custom"},
            "start_timestamp": start.isoformat(),
            "timestamp": now.isoformat(),
            "contexts": {
                "trace": {
                    "trace_id": trace_id,
                    "span_id": span_id,
                    "op": "ai.inference",
                    "status": status,
                    "data": {
                        "trace_ai.run_id": payload.run_id,
                        "trace_ai.project": project_name,
                        "trace_ai.anomaly_score": anomaly_score,
                        "trace_ai.triggered": triggered,
                    },
                }
            },
            "spans": [
                {
                    "trace_id": trace_id,
                    "span_id": child_span,
                    "parent_span_id": span_id,
                    "op": "ai.model.invoke",
                    "description": payload.model or "unknown",
                    "start_timestamp": start.isoformat(),
                    "timestamp": now.isoformat(),
                    "status": status,
                    "data": {
                        "ai.model_id": payload.model,
                        # OpenTelemetry GenAI semantic conventions
                        "gen_ai.usage.input_tokens":  payload.input_tokens  or 0,
                        "gen_ai.usage.output_tokens": payload.output_tokens or 0,
                        "gen_ai.system": "anthropic",
                    },
                }
            ],
            "measurements": {
                "latency_ms":    {"value": payload.latency_ms   or 0,                      "unit": "millisecond"},
                "input_tokens":  {"value": payload.input_tokens or 0,                      "unit": "none"},
                "output_tokens": {"value": payload.output_tokens or 0,                     "unit": "none"},
                "total_tokens":  {"value": payload.total_tokens or 0,                      "unit": "none"},
                "cost_usd_x1000": {"value": round((payload.cost or 0) * 1000, 4),         "unit": "none"},
                "anomaly_score": {"value": anomaly_score,                                  "unit": "none"},
            },
            "tags": {
                "trace_ai.run_id":     payload.run_id,
                "trace_ai.model":      payload.model or "unknown",
                "trace_ai.step":       payload.step_name or "unknown",
                "trace_ai.step_index": str(payload.step_index or 0),
                "trace_ai.project":    project_name,
                "trace_ai.success":    str(payload.status_success),
                "trace_ai.triggered":  str(triggered),
            },
            "level": "error" if triggered else "info",
        }

        scope = Scope()
        user_client.capture_event(event, scope=scope)
        user_client.flush(timeout=3)
        print(f"[sentry-perf] transaction: step={payload.step_name} trace={trace_id[:8]}… score={anomaly_score}")
    except Exception as exc:
        print(f"[ingest] sentry performance failed: {exc}")


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


def _dynamic_l4_limits(project_id: str, step_profile_id: str | None = None) -> dict[str, float] | None:
    """Compute dynamic L4 limits from recent call history.
    Scoped to step_profile_id when available — falls back to project-wide.
    Returns None when fewer than 30 calls exist."""
    try:
        query = (
            get_client()
            .table("CALLS")
            .select("latency_ms,total_tokens,cost")
            .eq("project_id", project_id)
            .order("created_at", desc=True)
            .limit(100)
        )
        if step_profile_id:
            query = query.eq("step_profile_id", step_profile_id)
        res = query.execute()
        rows = res.data or []
        if len(rows) < 30:
            return None

        def percentile(values: list[float], p: float) -> float:
            sorted_vals = sorted(values)
            idx = (len(sorted_vals) - 1) * p
            lo, hi = int(idx), min(int(idx) + 1, len(sorted_vals) - 1)
            return sorted_vals[lo] + (sorted_vals[hi] - sorted_vals[lo]) * (idx - lo)

        latencies = [r["latency_ms"] for r in rows if r.get("latency_ms") is not None]
        tokens    = [r["total_tokens"] for r in rows if r.get("total_tokens") is not None]
        costs     = [r["cost"] for r in rows if r.get("cost") is not None]

        limits: dict[str, float] = {}
        if latencies:
            limits["latency_ms_max"] = max(3000.0, percentile(latencies, 0.95))
        if tokens:
            limits["total_tokens_max"] = max(1000.0, percentile(tokens, 0.95))
        if costs:
            limits["cost_max"] = max(0.05, percentile(costs, 0.95))

        return limits or None
    except Exception as exc:
        print(f"[anomaly] dynamic limits failed: {exc}")
        return None


def _run_anomaly_detection(payload: IngestPayload, project: dict | None, step_profile_id: str | None = None) -> None:
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
                dynamic = _dynamic_l4_limits(project["id"], step_profile_id=step_profile_id)
                if dynamic:
                    config = EvalConfig(limits={**config.limits, **dynamic})
                    scope = f"profile={step_profile_id}" if step_profile_id else "project-wide"
                    print(f"[anomaly] dynamic L4 limits ({scope}): {dynamic}")

        # L5: inject per-step statistical baseline when available
        if step_profile_id:
            from services.baseline_service import compute_baseline
            baseline = compute_baseline(step_profile_id)
            if baseline:
                config = EvalConfig(**{**config.model_dump(), "baseline": baseline})
                print(f"[anomaly] L5 baseline for profile={step_profile_id}: n={baseline.sample_count}")
        result = evaluate_call(call_input, config)
        print(f"[anomaly] run={payload.run_id} step={payload.step_name} score={result.total_score} triggered={result.triggered} layer={result.stopped_at_layer} codes={dict(result.error_map)}")

        # Performance transaction for every call — fires even if no anomaly
        _perf_dsn   = project.get("sentry_dsn") if project else None
        _perf_level = (project.get("sentry_alert_level") or "critical") if project else "critical"
        if _perf_dsn and _perf_level != "none":
            _fire_user_sentry_performance(_perf_dsn, payload, result.total_score, result.triggered, project.get("name", "unknown"))

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


def _run_fingerprint_then_anomaly(payload: IngestPayload, project: dict | None, trace_id: str) -> None:
    """Fingerprint first to get step_profile_id, then run anomaly detection with it.
    Keeps them in one thread so anomaly detection gets per-step baselines."""
    step_profile_id: str | None = None

    if payload.project_id:
        try:
            from services.fingerprinter import match_or_create_profile
            profile_id, _ = match_or_create_profile(
                project_id=payload.project_id,
                step_name=payload.step_name,
                prompt_json=payload.prompt,
            )
            if profile_id:
                step_profile_id = profile_id
                get_client().table("CALLS").update(
                    {"step_profile_id": profile_id}
                ).eq("id", trace_id).execute()
        except Exception as exc:
            print(f"[fingerprint] failed: {exc}")

    _run_anomaly_detection(payload, project, step_profile_id=step_profile_id)


@router.post("/ingest", response_model=IngestResponse)
def ingest(request: Request, payload: IngestPayload) -> IngestResponse:
    auth = request.headers.get("Authorization", "")
    api_key = auth.removeprefix("Bearer ").strip()

    if not api_key:
        raise HTTPException(status_code=401, detail="Missing API key")

    project = _resolve_project(api_key)
    payload.project_id = project["id"] if project else None

    trace_id = ingest_trace(payload)

    threading.Thread(target=_run_fingerprint_then_anomaly, args=(payload, project, trace_id), daemon=True).start()

    if project:
        threading.Thread(target=_fire_slack, args=(project, payload), daemon=True).start()

    return IngestResponse(trace_id=trace_id)
