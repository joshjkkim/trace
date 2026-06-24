"""evaluate_call — run the weighted layers in order and produce an EvalResult.

Layers run L1 -> L2 -> L3 -> L4. Each fired condition contributes its penalty to
a running total via error_map. After each layer we check the threshold: once
total_score >= threshold the call is anomalous and we short-circuit, recording
which layer we stopped at.

Storage rule (plan): a clean call stores nothing. So when the run finishes below
threshold we return an empty report (hits=[], error_map={}, total_score=0) even
if some sub-threshold conditions technically fired — they were not enough to
flag the call.
"""

from __future__ import annotations

from .config import EvalConfig
from .layers.layer_1_hard import run_layer_1_hard
from .layers.layer_2_regex import run_layer_2_regex
from .layers.layer_3_fingerprinting import run_layer_3_fingerprinting
from .layers.layer_4_integers import run_layer_4_integers
from .layers.layer_5_statistical import run_layer_5_statistical
from .schemas import CallInput, EvalHit, EvalResult, LayerId
from .shape_classifier import classify_shape

# Ordered pipeline. (layer_id, runner) — order is the scoring order.
_LAYERS: list[tuple[LayerId, object]] = [
    ("L1_hard",        run_layer_1_hard),
    ("L2_format",      run_layer_2_regex),
    ("L3_fingerprint", run_layer_3_fingerprinting),
    ("L4_integers",    run_layer_4_integers),
    ("L5_statistical", run_layer_5_statistical),
]


def evaluate_call(payload: CallInput, config: EvalConfig | None = None) -> EvalResult:
    """Score one traced call. Returns a full EvalResult (clean or triggered)."""
    config = config or EvalConfig()

    # Computed for UI/debug regardless of outcome.
    prompt_shape = classify_shape(payload.prompt)
    output_shape = classify_shape(payload.output_code)

    hits: list[EvalHit] = []
    error_map: dict[int, float] = {}
    total = 0.0
    stopped_at: LayerId | None = None

    for layer_id, runner in _LAYERS:
        for hit in runner(payload, config):  # type: ignore[operator]
            hits.append(hit)
            error_map[hit.condition_code] = hit.penalty
            total += hit.penalty
        if total >= config.threshold:
            stopped_at = layer_id
            break

    triggered = total >= config.threshold

    return EvalResult(
        triggered=triggered,
        total_score=total,
        threshold=config.threshold,
        stopped_at_layer=stopped_at,
        hits=hits,
        error_map=error_map,
        prompt_shape=prompt_shape,
        output_shape=output_shape,
    )
