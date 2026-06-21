"""End-to-end tests for evaluate_call — one call per layer.

Each scenario is crafted to pass cleanly through the earlier layers and then be
flagged at exactly one target layer, so the short-circuit stops there:

    L1 — hard failure        (status_success=False)        -> stops at L1_hard
    L2 — JSON contract        (asks JSON, returns prose)     -> stops at L2_format
    L3 — shape/structure      (asks a number, returns prose  -> stops at L3_fingerprint
                               with a broken bracket)
    L4 — numeric thresholds   (latency/tokens/cost/ratio)    -> stops at L4_integers

Runnable two ways:

    cd anomaly && pytest
    ../backend/.venv/bin/python tests/test_evaluator.py   # prints each EvalResult
"""

from __future__ import annotations

import os
import sys

# Allow running directly (no install) by putting the package root on sys.path.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from config import EvalConfig
from evaluator import evaluate_call
from schemas import CallInput

CFG = EvalConfig()


# --- scenario builders ----------------------------------------------------

def clean_call() -> CallInput:
    """A well-formed yes/no classify call — should pass every layer."""
    return CallInput(
        step_name="classify-intent",
        model="claude-haiku-4-5",
        prompt="Is this message spam? Answer yes/no.",
        input_tokens=12, output_tokens=1, reasoning_tokens=0, total_tokens=13,
        latency_ms=140, cost=0.0002,
        status_success=True, error=None, output_code="no",
        run_id="run_clean", project_id=1,
    )


def l1_call() -> CallInput:
    """Hard failure: the call reported status_success=False (code 1001)."""
    return CallInput(
        step_name="classify-intent",
        model="claude-haiku-4-5",
        prompt="Is this message spam? Answer yes/no.",
        input_tokens=12, output_tokens=1, reasoning_tokens=0, total_tokens=13,
        latency_ms=140, cost=0.0002,
        status_success=False, error=None, output_code="no",
        run_id="run_l1", project_id=1,
    )


def l2_call() -> CallInput:
    """JSON contract violation: prompt asks for JSON, output is prose (2001)."""
    return CallInput(
        step_name="extract-fields",
        model="claude-haiku-4-5",
        prompt='Return the result as JSON with keys "name" and "age".',
        input_tokens=20, output_tokens=12, reasoning_tokens=0, total_tokens=32,
        latency_ms=320, cost=0.0006,
        status_success=True, error=None,
        output_code="Sure! The name is Bob and the age is 30.",
        run_id="run_l2", project_id=1,
    )


def l3_call() -> CallInput:
    """Shape + structure anomaly: prompt implies a number, output is prose with
    an unbalanced brace — fires 3014 (shape mismatch) + 3011 (bracket imbalance).
    Crucially uses no JSON/enum/yes-no wording, so L2 stays silent."""
    return CallInput(
        step_name="answer-question",
        model="claude-haiku-4-5",
        prompt="How many planets are in the solar system? Respond with just a number.",
        input_tokens=18, output_tokens=14, reasoning_tokens=0, total_tokens=32,
        latency_ms=300, cost=0.0005,
        status_success=True, error=None,
        output_code="There are eight planets, though some lists include {Pluto.",
        run_id="run_l3", project_id=1,
    )


def l4_call() -> CallInput:
    """Numeric thresholds: a draft step that blew past latency, token, cost and
    ratio limits — fires 4001 + 4002 + 4003 + 4004. No contract/shape wording,
    so L1/L2/L3 stay silent and the run reaches L4. The body length is chosen so
    chars-per-token stays plausible (no 4009 noise)."""
    body = "word " * 40_000  # 200_000 chars / 80_000 tokens = 2.5 chars/token
    return CallInput(
        step_name="draft-report",
        model="claude-opus-4-8",
        prompt="Draft a detailed quarterly report covering revenue and risks.",
        input_tokens=1_000, output_tokens=80_000, reasoning_tokens=0, total_tokens=81_000,
        latency_ms=20_000, cost=3.5,
        status_success=True, error=None, output_code=body,
        run_id="run_l4", project_id=1,
    )


# --- assertions -----------------------------------------------------------

def test_clean_call_is_clean():
    r = evaluate_call(clean_call(), CFG)
    assert r.clean
    assert r.hits == []
    assert r.error_map == {}
    assert r.stopped_at_layer is None


def test_l1_stops_at_hard():
    r = evaluate_call(l1_call(), CFG)
    assert r.triggered
    assert r.stopped_at_layer == "L1_hard"
    assert 1001 in r.error_map
    assert r.total_score >= r.threshold


def test_l2_stops_at_format():
    r = evaluate_call(l2_call(), CFG)
    assert r.triggered
    assert r.stopped_at_layer == "L2_format"
    assert 2001 in r.error_map
    assert r.hits[0].step_name == "extract-fields"
    # Earlier layer (L1) stayed silent.
    assert all(h.layer == "L2_format" for h in r.hits)


def test_l3_stops_at_fingerprint():
    r = evaluate_call(l3_call(), CFG)
    assert r.triggered
    assert r.stopped_at_layer == "L3_fingerprint"
    assert {3011, 3014} <= set(r.error_map)
    # L1 + L2 stayed silent.
    assert all(h.layer == "L3_fingerprint" for h in r.hits)


def test_l4_stops_at_integers():
    r = evaluate_call(l4_call(), CFG)
    assert r.triggered
    assert r.stopped_at_layer == "L4_integers"
    assert {4001, 4002, 4003, 4004} <= set(r.error_map)
    # L1 + L2 + L3 stayed silent.
    assert all(h.layer == "L4_integers" for h in r.hits)


# --- minimal runner so this works without pytest + prints the outputs -----

def _show(title: str, payload: CallInput) -> None:
    r = evaluate_call(payload, CFG)
    print(f"\n=== {title} ===")
    print(f"  triggered        : {r.triggered}")
    print(f"  total_score      : {r.total_score}  (threshold {r.threshold})")
    print(f"  stopped_at_layer : {r.stopped_at_layer}")
    print(f"  prompt_shape     : {r.prompt_shape}   output_shape: {r.output_shape}")
    print(f"  error_map        : {r.error_map}")
    for h in r.hits:
        print(f"    - {h.condition_code} {h.rule_name} (+{h.penalty}) "
              f"observed={h.observed!r} expected={h.expected!r}")


if __name__ == "__main__":
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    passed = 0
    for t in tests:
        try:
            t()
        except AssertionError as e:
            print(f"FAIL  {t.__name__}: {e}")
        except Exception as e:  # noqa: BLE001
            print(f"ERROR {t.__name__}: {type(e).__name__}: {e}")
        else:
            passed += 1
            print(f"PASS  {t.__name__}")
    print(f"\n{passed}/{len(tests)} passed")

    # Print the full EvalResult for each layer's scenario.
    _show("clean (passes all layers)", clean_call())
    _show("L1 — hard failure", l1_call())
    _show("L2 — JSON contract violation", l2_call())
    _show("L3 — shape / structure anomaly", l3_call())
    _show("L4 — numeric thresholds", l4_call())

    sys.exit(0 if passed == len(tests) else 1)
