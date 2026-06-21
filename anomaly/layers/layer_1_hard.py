"""Layer 1 — hard failures.

Deterministic, non-heuristic checks. These are facts about the trace that are
unambiguously wrong (the call failed, carries an error, has impossible numbers,
or is missing required identity fields). No shape/contract guessing happens
here — that is L2/L3/L4.

Each branch references a condition code from condition_registry (1001-1008) and
appends an EvalHit. The evaluator is responsible for turning hits into the
error_map / total_score and short-circuiting on the threshold; this layer only
detects.
"""

from __future__ import annotations

from condition_registry import describe
from config import EvalConfig
from schemas import CallInput, EvalHit


def _is_blank(value: str | None) -> bool:
    return value is None or value.strip() == ""


def run_layer_1_hard(payload: CallInput, config: EvalConfig) -> list[EvalHit]:
    """Run all L1 hard checks against one call. Returns the fired hits (possibly
    empty). Order is stable so output is deterministic."""

    hits: list[EvalHit] = []

    def fire(code: int, observed: object | None = None, expected: object | None = None) -> None:
        cond = describe(code)
        hits.append(
            EvalHit(
                condition_code=cond.code,
                layer=cond.layer,
                rule_name=cond.name,
                step_name=payload.step_name,
                run_id=payload.run_id,
                penalty=config.penalty_for(cond.code, cond.penalty),
                message=cond.description,
                observed=observed,
                expected=expected,
            )
        )

    # 1001 — call explicitly reported failure.
    if payload.status_success is False:
        fire(1001, observed=payload.status_success, expected=True)

    # 1002 — non-empty error message attached.
    if not _is_blank(payload.error):
        fire(1002, observed=payload.error)

    # 1003 — succeeded but produced no output body.
    if payload.status_success and _is_blank(payload.output_code):
        fire(1003, observed=payload.output_code, expected="non-empty output_code")

    # 1004 — impossible negative token counts.
    negative_tokens = {
        name: val
        for name, val in (
            ("input_tokens", payload.input_tokens),
            ("output_tokens", payload.output_tokens),
            ("reasoning_tokens", payload.reasoning_tokens),
            ("total_tokens", payload.total_tokens),
        )
        if val is not None and val < 0
    }
    if negative_tokens:
        fire(1004, observed=negative_tokens, expected=">= 0")

    # 1005 — impossible negative latency.
    if payload.latency_ms is not None and payload.latency_ms < 0:
        fire(1005, observed=payload.latency_ms, expected=">= 0")

    # 1006 — impossible negative cost.
    if payload.cost is not None and payload.cost < 0:
        fire(1006, observed=payload.cost, expected=">= 0")

    # 1007 — total_tokens must equal the sum of its parts when all are present.
    if payload.total_tokens is not None and (
        payload.input_tokens is not None or payload.output_tokens is not None
    ):
        components = (
            (payload.input_tokens or 0)
            + (payload.output_tokens or 0)
            + (payload.reasoning_tokens or 0)
        )
        if components != payload.total_tokens:
            fire(1007, observed=payload.total_tokens, expected=components)

    # 1008 — required identity fields must be present.
    missing = [
        name
        for name, val in (
            ("step_name", payload.step_name),
            ("model", payload.model),
            ("prompt", payload.prompt),
            ("run_id", payload.run_id),
        )
        if _is_blank(val)
    ]
    if missing:
        fire(1008, observed=missing, expected="non-empty")

    return hits
