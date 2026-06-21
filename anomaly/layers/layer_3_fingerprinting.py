"""Layer 3 — fingerprinting (shape + structural features).

Heuristic, hardcoded checks (no ML, no history). Two parts:

  A) Shape mismatch — compare the shape the prompt implies (infer_expected_shape)
     against the classified output shape (classify_shape).
  B) Structural features — brackets, JSON keys, word/length ratios.

Catches "wrong format" / "malformed structure" that L2's contract regexes miss
(e.g. a prompt that implies a number but gets prose, or output with broken
brackets). Shared heuristics live in shape_classifier so L4 reuses them.

Each branch references a condition code (3010-3014) and appends an EvalHit. The
evaluator handles scoring / short-circuiting; this layer only detects.
"""

from __future__ import annotations

from condition_registry import describe
from config import EvalConfig
from schemas import CallInput, EvalHit
from shape_classifier import (
    classify_shape,
    extract_struct_features,
    infer_expected_shape,
    keys_named_in_prompt,
    word_cap,
)


def run_layer_3_fingerprinting(payload: CallInput, config: EvalConfig) -> list[EvalHit]:
    """Run all L3 shape/structure checks. Returns fired hits (possibly empty)."""

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

    prompt = payload.prompt or ""
    out = payload.output_code
    expected = infer_expected_shape(prompt)
    actual = classify_shape(out)
    feats = extract_struct_features(out)

    # 3014 — prompt implies a shape the output does not match. Skip when output
    # is empty (that is an L1 concern) or when there is no expectation.
    if expected is not None and actual != "empty" and actual != expected:
        fire(3014, observed=actual, expected=expected)

    # 3011 — malformed structure: unbalanced {} or [].
    if feats.bracket_imbalance:
        fire(
            3011,
            observed={"curly_balance": feats.curly_balance, "square_balance": feats.square_balance},
            expected="balanced brackets",
        )

    # 3012 — JSON keys named in the prompt are missing from the output object.
    if expected == "json":
        wanted = keys_named_in_prompt(prompt)
        if wanted and feats.json_keys:
            missing = wanted - feats.json_keys
            if missing:
                fire(3012, observed=sorted(feats.json_keys), expected=sorted(wanted))

    # 3010 — prompt capped answer length but output ran long.
    cap = word_cap(prompt)
    if cap is not None and feats.word_count > cap:
        fire(3010, observed=feats.word_count, expected=f"<= {cap} word(s)")

    # 3013 — output is hugely larger than the prompt for a short-answer step.
    step = (payload.step_name or "").lower()
    if any(k in step for k in ("classify", "intent", "enum")):
        len_ratio = feats.char_count / max(len(prompt), 1)
        cap_ratio = config.limits.get("max_len_ratio_classify", 20.0)
        if len_ratio > cap_ratio:
            fire(3013, observed=round(len_ratio, 1), expected=f"<= {cap_ratio}")

    return hits
