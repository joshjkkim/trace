"""Compute per-step-profile statistical baselines from call history.

Called inside the fingerprint→anomaly background thread, after the step_profile_id
is known. Queries the last N calls for that profile, computes mean+std for each
metric, and returns a StepBaseline to inject into EvalConfig before L5 runs.

Minimum 20 samples required — returns None if history is too thin.
"""

from __future__ import annotations

import math

from anomaly.schemas import MetricStat, StepBaseline
from db import get_client

MIN_SAMPLES = 20
HISTORY_LIMIT = 200


def _stat(values: list[float]) -> MetricStat | None:
    n = len(values)
    if n < MIN_SAMPLES:
        return None
    mean = sum(values) / n
    variance = sum((v - mean) ** 2 for v in values) / n
    return MetricStat(mean=mean, std=math.sqrt(variance), count=n)


def compute_baseline(step_profile_id: str) -> StepBaseline | None:
    """Return a StepBaseline for the given profile, or None if not enough data."""
    try:
        res = (
            get_client()
            .table("CALLS")
            .select("latency_ms,total_tokens,output_tokens,cost")
            .eq("step_profile_id", step_profile_id)
            .eq("status_success", True)
            .order("created_at", desc=True)
            .limit(HISTORY_LIMIT)
            .execute()
        )
        rows = res.data or []
        if len(rows) < MIN_SAMPLES:
            return None

        latencies     = [r["latency_ms"]    for r in rows if r.get("latency_ms")    is not None]
        total_tokens  = [r["total_tokens"]  for r in rows if r.get("total_tokens")  is not None]
        output_tokens = [r["output_tokens"] for r in rows if r.get("output_tokens") is not None]
        costs         = [r["cost"]          for r in rows if r.get("cost")          is not None]

        return StepBaseline(
            sample_count=len(rows),
            latency_ms=_stat(latencies),
            total_tokens=_stat(total_tokens),
            output_tokens=_stat(output_tokens),
            cost=_stat(costs),
        )
    except Exception as exc:
        print(f"[baseline] failed for profile={step_profile_id}: {exc}")
        return None
