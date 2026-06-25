"""Layer 5 — IQR/log-normal deviation from per-step-profile baseline.

Replaces the earlier z-score approach. LLM latency, cost, and token counts are
right-skewed (log-normal in practice), so z-scores against mean/std are badly
calibrated: the long tail inflates std, making true spikes look like 2σ events
when they're really 10× outliers.

Detection is now via the Tukey fence in log space:
  anomalous  iff  log(x) > log(Q3) + k * log_IQR
                  log(x) < log(Q1) - k * log_IQR

k = EvalConfig.iqr_fence_k (default 2.5). The returned 'deviation' is how many
IQR-widths (in log space) the value sits outside the fence — analogous to σ but
distribution-free. A deviation of 0 means right at the fence; 1.0 means one full
IQR-width beyond it.

Fires when a baseline exists and deviation > 0:
  5001  latency_ms
  5002  total_tokens
  5003  cost
  5004  output_tokens

No baseline → no hits. L4's 4001/4002/4003 serve as the cold-start fallback.
"""

from __future__ import annotations

from ..condition_registry import describe
from ..config import EvalConfig
from ..schemas import CallInput, EvalHit, MetricStat


def run_layer_5_statistical(payload: CallInput, config: EvalConfig) -> list[EvalHit]:
    baseline = config.baseline
    if baseline is None:
        return []

    hits: list[EvalHit] = []
    k = config.iqr_fence_k

    def fire(code: int, deviation: float, observed: float, stat: MetricStat) -> None:
        cond      = describe(code)
        direction = "above upper fence" if deviation > 0 else "below lower fence"
        if stat.log_transform and stat.log_q1 is not None:
            fence_desc = (
                f"log-IQR fence: Q1={stat.q1:.2f} Q3={stat.q3:.2f} "
                f"log_IQR={stat.log_iqr:.3f} k={k} "
                f"(deviation={deviation:+.2f} IQR-widths, {direction})"
            )
        else:
            fence_desc = (
                f"IQR fence: Q1={stat.q1:.2f} Q3={stat.q3:.2f} "
                f"IQR={stat.iqr:.2f} k={k} "
                f"(deviation={deviation:+.2f} IQR-widths, {direction})"
            )
        hits.append(EvalHit(
            condition_code=cond.code,
            layer=cond.layer,
            rule_name=cond.name,
            step_name=payload.step_name,
            run_id=payload.run_id,
            penalty=config.penalty_for(cond.code, cond.penalty),
            message=cond.description,
            observed=round(observed, 4),
            expected=fence_desc,
        ))

    def check(code: int, stat: MetricStat | None, observed: float | None) -> None:
        if stat is None or observed is None:
            return
        deviation = stat.iqr_deviation(observed, k=k)
        if deviation is not None:
            fire(code, deviation, observed, stat)

    check(5001, baseline.latency_ms,    payload.latency_ms)
    check(5002, baseline.total_tokens,  payload.total_tokens)
    check(5003, baseline.cost,          payload.cost)
    check(5004, baseline.output_tokens, payload.output_tokens)

    return hits
