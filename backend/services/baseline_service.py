"""Compute per-step-profile statistical baselines from call history.

Three hardening rules applied to the query:
  1. Model-scoped  — only calls using the same model as the current call,
                     so a haiku→sonnet switch doesn't mix two latency distributions.
  2. Evolution-cut — only calls after last_evolved_at on the profile, so a
                     meaningful prompt rewrite forces a clean re-warm instead of
                     blending old and new behaviour.
  3. Anomaly-free  — excludes calls that themselves triggered anomalies, so a
                     sustained degradation period doesn't shift the mean and widen
                     the std until L5 goes blind to it.

Returns None when fewer than MIN_SAMPLES clean calls exist after filtering —
the caller falls back to L4 static thresholds in that case.
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


def compute_baseline(step_profile_id: str, model: str | None = None) -> StepBaseline | None:
    """Return a StepBaseline for the given profile, or None if not enough data."""
    try:
        # Rule 2: find the evolution cutoff timestamp for this profile
        last_evolved_at: str | None = None
        try:
            prof = (
                get_client()
                .table("step_profiles")
                .select("last_evolved_at")
                .eq("id", step_profile_id)
                .single()
                .execute()
            )
            last_evolved_at = prof.data.get("last_evolved_at") if prof.data else None
        except Exception:
            pass

        query = (
            get_client()
            .table("CALLS")
            .select("latency_ms,total_tokens,output_tokens,cost")
            .eq("step_profile_id", step_profile_id)
            .eq("status_success", True)
            # Rule 3: exclude calls that themselves triggered anomalies;
            # NULL means the column didn't exist yet — treat as non-anomalous
            .or_("anomaly_triggered.is.null,anomaly_triggered.eq.false")
            .order("created_at", desc=True)
            .limit(HISTORY_LIMIT)
        )

        # Rule 1: scope to same model so latency distributions don't cross-contaminate
        if model:
            query = query.eq("model", model)

        # Rule 2: discard calls from before the last prompt evolution
        if last_evolved_at:
            query = query.gte("created_at", last_evolved_at)

        res = query.execute()
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
