"""Tests for Layer 1 (hard failures).

Each test documents one PASS (clean, no hits) or FAIL (a specific hard code
fires) scenario. Runnable two ways:

    cd anomaly && pytest                       # once pytest is installed
    ../backend/.venv/bin/python tests/test_layer_1_hard.py   # no pytest needed
"""

from __future__ import annotations

import os
import sys

# Allow running directly (no install) by putting the package root on sys.path.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from config import EvalConfig
from layers.layer_1_hard import run_layer_1_hard
from schemas import CallInput

CFG = EvalConfig()


def _base(**overrides) -> CallInput:
    """A valid, clean call. Override fields to construct failure cases."""
    data = dict(
        step_name="classify-intent",
        model="claude-haiku-4-5",
        prompt="Is this spam? yes/no",
        input_tokens=12,
        output_tokens=1,
        reasoning_tokens=0,
        total_tokens=13,
        latency_ms=140,
        cost=0.0002,
        status_success=True,
        error=None,
        output_code="no",
        run_id="run_abc",
        project_id=1,
    )
    data.update(overrides)
    return CallInput(**data)


def _codes(payload: CallInput) -> set[int]:
    return {h.condition_code for h in run_layer_1_hard(payload, CFG)}


# --- PASS: clean calls produce zero hits ---------------------------------

def test_clean_call_passes():
    assert _codes(_base()) == set()


def test_clean_call_with_optionals_omitted_passes():
    # No tokens / cost reported at all — nothing to validate, still clean.
    payload = _base(
        input_tokens=None, output_tokens=None, reasoning_tokens=None,
        total_tokens=None, cost=None,
    )
    assert _codes(payload) == set()


def test_failed_call_does_not_double_report_empty_output():
    # status_success=False with empty output should fire 1001 only — 1003 is
    # gated on success so it must NOT fire here.
    codes = _codes(_base(status_success=False, output_code=""))
    assert 1001 in codes
    assert 1003 not in codes


# --- FAIL: each hard condition fires its code ----------------------------

def test_1001_status_failure():
    assert 1001 in _codes(_base(status_success=False))


def test_1002_error_present():
    assert 1002 in _codes(_base(error="RateLimitError: 429"))


def test_1003_empty_output_on_success():
    assert 1003 in _codes(_base(output_code="   "))  # whitespace counts as blank


def test_1004_negative_tokens():
    assert 1004 in _codes(_base(output_tokens=-3, total_tokens=9))


def test_1005_negative_latency():
    assert 1005 in _codes(_base(latency_ms=-1))


def test_1006_negative_cost():
    assert 1006 in _codes(_base(cost=-0.01))


def test_1007_token_accounting_mismatch():
    # 12 + 1 + 0 = 13, declare 99 instead.
    assert 1007 in _codes(_base(total_tokens=99))


def test_1007_token_accounting_passes_when_consistent():
    assert 1007 not in _codes(_base(input_tokens=12, output_tokens=1, reasoning_tokens=0, total_tokens=13))


def test_1008_missing_required_field():
    assert 1008 in _codes(_base(model="   "))


# --- FAIL: multiple conditions accumulate --------------------------------

def test_multiple_hard_failures_fire_together():
    payload = _base(
        status_success=False,    # 1001
        error="boom",            # 1002
        latency_ms=-5,           # 1005
        cost=-1.0,               # 1006
        total_tokens=99,         # 1007
    )
    assert _codes(payload) == {1001, 1002, 1005, 1006, 1007}


# --- minimal runner so this works without pytest -------------------------

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
    sys.exit(0 if passed == len(tests) else 1)
