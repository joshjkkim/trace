"""Per-step trend detection.

Compares each step profile's recent window (last 10 calls) against its
baseline window (calls 11-60) to detect gradual degradation that per-call
anomaly detection misses.

Uses IQR-based deviation in log space (matching L5) rather than z-scores.
Deviation = how many IQR-widths the recent window mean sits outside the
baseline Tukey fence [Q1 - k*IQR, Q3 + k*IQR], computed in log space for
right-skewed LLM metrics.

Returns a health status per step profile:
  healthy    — recent mean is within the baseline IQR box (Q1..Q3)
  degrading  — recent mean has drifted outside Q1/Q3 but within the fence
  critical   — recent mean is outside the Tukey fence (k=2.5)
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from db import get_client

RECENT_N   = 10
BASELINE_N = 50
FENCE_K    = 2.5  # Tukey fence multiplier, same as EvalConfig.iqr_fence_k


@dataclass
class MetricTrend:
    metric: str
    baseline_mean: float
    recent_mean: float
    sigma: float        # IQR-fence deviation (kept as 'sigma' for API compat)
    direction: str      # "up" or "down"


MIN_SAMPLES_FOR_L5 = 20  # must match baseline_service.MIN_SAMPLES

@dataclass
class StepHealth:
    step_profile_id: str
    step_name: str
    status: str             # "warming" | "healthy" | "degrading" | "critical"
    sample_count: int
    trends: list[MetricTrend]


def _percentile(sorted_vals: list[float], p: float) -> float:
    n   = len(sorted_vals)
    pos = p * (n - 1)
    lo  = int(pos)
    hi  = min(lo + 1, n - 1)
    return sorted_vals[lo] + (sorted_vals[hi] - sorted_vals[lo]) * (pos - lo)


def _iqr_deviation(baseline_vals: list[float], recent_vals: list[float]) -> float | None:
    """Signed IQR-fence deviation of recent_mean against the baseline distribution.

    Computed in log space (for positive, right-skewed LLM metrics):
      - deviation > 0  → recent mean is above the upper fence (Q3 + k*IQR)
      - deviation < 0  → recent mean is below the lower fence (Q1 - k*IQR)
      - deviation = 0  → within the fence (healthy)

    The magnitude is 'how many IQR-widths outside the fence', analogous to σ
    but without assuming a normal distribution.
    """
    if not baseline_vals or not recent_vals:
        return None

    pos_baseline = [v for v in baseline_vals if v > 0]
    if len(pos_baseline) < 4:
        return None

    log_vals = sorted(math.log(v) for v in pos_baseline)
    q1       = _percentile(log_vals, 0.25)
    q3       = _percentile(log_vals, 0.75)
    iqr      = q3 - q1
    if iqr < 1e-9:
        return None

    recent_pos = [v for v in recent_vals if v > 0]
    if not recent_pos:
        return None

    log_recent_mean = math.log(sum(recent_pos) / len(recent_pos))
    upper_fence = q3 + FENCE_K * iqr
    lower_fence = q1 - FENCE_K * iqr

    if log_recent_mean > upper_fence:
        return (log_recent_mean - upper_fence) / iqr
    if log_recent_mean < lower_fence:
        return (log_recent_mean - lower_fence) / iqr
    # Within fence — but still report IQR-box deviation for degrading status
    if log_recent_mean > q3:
        return (log_recent_mean - q3) / iqr       # small positive: above IQR box
    if log_recent_mean < q1:
        return (log_recent_mean - q1) / iqr       # small negative: below IQR box
    return 0.0


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
        worst_dev = 0.0

        for metric, b_vals, r_vals in [
            ("latency_ms",   vals(baseline, "latency_ms"),   vals(recent, "latency_ms")),
            ("total_tokens", vals(baseline, "total_tokens"), vals(recent, "total_tokens")),
            ("cost",         vals(baseline, "cost"),         vals(recent, "cost")),
        ]:
            dev = _iqr_deviation(b_vals, r_vals)
            # Only surface trends where the mean has drifted outside the IQR box
            if dev is None or abs(dev) < 0.1:
                continue
            recent_pos  = [v for v in r_vals if v > 0]
            baseline_pos = [v for v in b_vals if v > 0]
            if not recent_pos or not baseline_pos:
                continue
            trends.append(MetricTrend(
                metric=metric,
                baseline_mean=sum(baseline_pos) / len(baseline_pos),
                recent_mean=sum(recent_pos) / len(recent_pos),
                sigma=round(dev, 2),
                direction="up" if dev > 0 else "down",
            ))
            worst_dev = max(worst_dev, abs(dev))

        # critical  — recent mean is outside the Tukey fence (|dev| > FENCE_K means >fence)
        # degrading — recent mean has drifted outside the IQR box but within fence (|dev| > 0)
        # healthy   — within IQR box
        status = (
            "critical"  if worst_dev > FENCE_K else
            "degrading" if worst_dev > 0.1     else
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
