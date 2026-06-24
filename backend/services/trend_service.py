"""Per-step trend detection.

Compares each step profile's recent window (last 10 calls) against its
baseline window (calls 11-60) to detect gradual degradation that per-call
anomaly detection misses.

Returns a health status per step profile:
  healthy    — recent metrics are within 1.5σ of baseline
  degrading  — at least one metric has drifted 1.5–3σ
  critical   — at least one metric has drifted >3σ
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from db import get_client

RECENT_N   = 10
BASELINE_N = 50
WARN_SIGMA = 1.5
CRIT_SIGMA = 3.0


@dataclass
class MetricTrend:
    metric: str
    baseline_mean: float
    recent_mean: float
    sigma: float        # how many σ recent_mean is from baseline_mean
    direction: str      # "up" or "down"


MIN_SAMPLES_FOR_L5 = 20  # must match baseline_service.MIN_SAMPLES

@dataclass
class StepHealth:
    step_profile_id: str
    step_name: str
    status: str             # "warming" | "healthy" | "degrading" | "critical"
    sample_count: int
    trends: list[MetricTrend]


def _sigma(baseline_vals: list[float], recent_vals: list[float]) -> float | None:
    """How many σ is recent_mean above baseline_mean?"""
    if not baseline_vals or not recent_vals:
        return None
    b_mean = sum(baseline_vals) / len(baseline_vals)
    b_std  = math.sqrt(sum((v - b_mean) ** 2 for v in baseline_vals) / len(baseline_vals))
    if b_std < 1e-9:
        return None
    r_mean = sum(recent_vals) / len(recent_vals)
    return (r_mean - b_mean) / b_std


def compute_project_health(project_id: str) -> list[StepHealth]:
    """Return health for every step profile in the project that has enough data."""
    try:
        profiles_res = (
            get_client()
            .table("step_profiles")
            .select("id,step_name")
            .eq("project_id", project_id)
            .execute()
        )
        profiles = profiles_res.data or []
    except Exception as exc:
        print(f"[trend] failed to fetch profiles for project={project_id}: {exc}")
        return []

    results: list[StepHealth] = []

    for profile in profiles:
        pid  = profile["id"]
        name = profile.get("step_name", "unknown")

        try:
            res = (
                get_client()
                .table("CALLS")
                .select("latency_ms,total_tokens,cost,created_at")
                .eq("step_profile_id", pid)
                .eq("status_success", True)
                .order("created_at", desc=True)
                .limit(RECENT_N + BASELINE_N)
                .execute()
            )
            rows = res.data or []
        except Exception as exc:
            print(f"[trend] failed to fetch calls for profile={pid}: {exc}")
            continue

        if len(rows) < RECENT_N + 10:
            results.append(StepHealth(
                step_profile_id=pid,
                step_name=name,
                status="warming",
                sample_count=len(rows),
                trends=[],
            ))
            continue

        recent   = rows[:RECENT_N]
        baseline = rows[RECENT_N:]

        def vals(r_list, key):
            return [r[key] for r in r_list if r.get(key) is not None]

        trends: list[MetricTrend] = []
        worst_sigma = 0.0

        for metric, b_vals, r_vals in [
            ("latency_ms",   vals(baseline, "latency_ms"),   vals(recent, "latency_ms")),
            ("total_tokens", vals(baseline, "total_tokens"), vals(recent, "total_tokens")),
            ("cost",         vals(baseline, "cost"),         vals(recent, "cost")),
        ]:
            s = _sigma(b_vals, r_vals)
            if s is None or abs(s) < WARN_SIGMA:
                continue
            trends.append(MetricTrend(
                metric=metric,
                baseline_mean=sum(b_vals) / len(b_vals),
                recent_mean=sum(r_vals) / len(r_vals),
                sigma=round(s, 2),
                direction="up" if s > 0 else "down",
            ))
            worst_sigma = max(worst_sigma, abs(s))

        status = (
            "critical"  if worst_sigma >= CRIT_SIGMA else
            "degrading" if worst_sigma >= WARN_SIGMA else
            "healthy"
        )

        results.append(StepHealth(
            step_profile_id=pid,
            step_name=name,
            status=status,
            sample_count=len(rows),
            trends=trends,
        ))

    return results
