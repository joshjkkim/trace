"""Layer 5 — statistical deviation from per-step-profile baseline.

Only runs when EvalConfig.baseline is populated (computed upstream from the
step_profile's call history). Each metric is scored as a z-score against the
step's own mean/std — so a call is anomalous relative to *what this specific
step normally does*, not a project-wide limit.

Fires when |z| > config.zscore_threshold (default 3.0):
  5001  latency_ms
  5002  total_tokens
  5003  cost
  5004  output_tokens

No baseline → no hits. L4's 4001/4002/4003 serve as the cold-start fallback.
"""

from __future__ import annotations

from ..condition_registry import describe
from ..config import EvalConfig
from ..schemas import CallInput, EvalHit


def run_layer_5_statistical(payload: CallInput, config: EvalConfig) -> list[EvalHit]:
    baseline = config.baseline
    if baseline is None:
        return []

    hits: list[EvalHit] = []
    z_thresh = config.zscore_threshold

    def fire(code: int, z: float, observed: float, mean: float, std: float) -> None:
        cond = describe(code)
        direction = "above" if z > 0 else "below"
        hits.append(EvalHit(
            condition_code=cond.code,
            layer=cond.layer,
            rule_name=cond.name,
            step_name=payload.step_name,
            run_id=payload.run_id,
            penalty=config.penalty_for(cond.code, cond.penalty),
            message=cond.description,
            observed=round(observed, 4),
            expected=f"{round(mean, 2)} ± {round(std, 2)} (z={z:+.2f}, {direction} {z_thresh}σ threshold)",
        ))

    def check(code: int, stat, observed: float | None) -> None:
        if stat is None or observed is None:
            return
        z = stat.zscore(observed)
        if z is not None and abs(z) > z_thresh:
            fire(code, z, observed, stat.mean, stat.std)

    check(5001, baseline.latency_ms,     payload.latency_ms)
    check(5002, baseline.total_tokens,   payload.total_tokens)
    check(5003, baseline.cost,           payload.cost)
    check(5004, baseline.output_tokens,  payload.output_tokens)

    return hits
