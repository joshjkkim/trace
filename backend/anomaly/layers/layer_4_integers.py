"""Layer 4 — integers (static thresholds + cross-field plausibility).

Numeric sanity checks: raw limits (latency / tokens / cost / ratio) from
EvalConfig.limits, plus cross-field rules that combine a step's expected shape
(from shape_classifier) with its token / latency profile. No history required.

Penalties here are individually small (10-25) — several must fire before the
default threshold (50) is crossed, by design: one large number alone is rarely
an anomaly, a cluster of them is.

Each branch references a condition code (4001-4010) and appends an EvalHit. The
evaluator handles scoring / short-circuiting; this layer only detects.
"""

from __future__ import annotations

from ..condition_registry import describe
from ..config import EvalConfig
from ..schemas import CallInput, EvalHit
from ..shape_classifier import infer_expected_shape


def run_layer_4_integers(payload: CallInput, config: EvalConfig) -> list[EvalHit]:
    """Run all L4 numeric / cross-field checks. Returns fired hits (possibly empty)."""

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

    lim = config.limits
    out = payload.output_code or ""
    in_tok = payload.input_tokens or 0
    out_tok = payload.output_tokens or 0
    expected = infer_expected_shape(payload.prompt or "")
    step = (payload.step_name or "").lower()

    # 4001/4002/4003 — raw threshold checks.
    # Deferred when a per-step statistical baseline is active (L5 owns these metrics
    # with z-scores when baseline is present, to avoid double-counting).
    has_baseline = config.baseline is not None
    if not has_baseline:
        if payload.latency_ms is not None and payload.latency_ms > lim["latency_ms_max"]:
            fire(4001, observed=payload.latency_ms, expected=f"<= {lim['latency_ms_max']}")
        if payload.total_tokens is not None and payload.total_tokens > lim["total_tokens_max"]:
            fire(4002, observed=payload.total_tokens, expected=f"<= {lim['total_tokens_max']}")
        if payload.cost is not None and payload.cost > lim["cost_max"]:
            fire(4003, observed=payload.cost, expected=f"<= {lim['cost_max']}")

    # 4004 — output/input token ratio anomaly.
    if in_tok > 0:
        ratio = out_tok / in_tok
        if ratio > lim["output_input_ratio_max"]:
            fire(4004, observed=round(ratio, 1), expected=f"<= {lim['output_input_ratio_max']}")

    # 4005 — classify/intent step emitted far more tokens than such a step should.
    classify_cap = config.step_limits.get("classify", {}).get("max_output_tokens", 50)
    if any(k in step for k in ("classify", "intent")) and out_tok > classify_cap:
        fire(4005, observed=out_tok, expected=f"<= {classify_cap}")

    # 4006 — short-answer (enum) step produced too many tokens.
    if expected == "enum_short" and out_tok > 30:
        fire(4006, observed=out_tok, expected="<= 30")

    # 4007 — high latency but almost no output (stall / hang signature).
    if payload.latency_ms is not None and payload.latency_ms > 3000 and out_tok < 10:
        fire(4007, observed={"latency_ms": payload.latency_ms, "output_tokens": out_tok})

    # 4008 — JSON-expected step rambled into a huge token count.
    if expected == "json" and out_tok > 500:
        fire(4008, observed=out_tok, expected="<= 500")

    # 4009 — chars-per-token outside the plausible range (garbled accounting).
    # Only meaningful for longer outputs — short classify responses (1-3 tokens)
    # have too little signal for the ratio to be reliable.
    if out_tok >= 10 and out:
        cpt = len(out) / out_tok
        if cpt < lim["chars_per_token_min"] or cpt > lim["chars_per_token_max"]:
            fire(
                4009,
                observed=round(cpt, 2),
                expected=f"{lim['chars_per_token_min']}-{lim['chars_per_token_max']}",
            )

    # 4010 — zero output tokens reported but a non-empty body exists.
    if out_tok == 0 and out.strip():
        fire(4010, observed=len(out), expected="output_tokens > 0")

    return hits
