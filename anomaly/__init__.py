"""trace-anomaly — standalone weighted-layer scoring for traced LLM calls.

Flat layout: modules import each other by bare name (``from schemas import ...``),
so we put this package directory on sys.path on import. That lets callers do
either ``import anomaly`` or run the modules/tests directly with the package root
on the path.
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from condition_registry import CONDITION_REGISTRY, ConditionDef, describe  # noqa: E402
from config import EvalConfig  # noqa: E402
from evaluator import evaluate_call  # noqa: E402
from schemas import CallInput, EvalHit, EvalResult, LayerId, OutputShape  # noqa: E402

__all__ = [
    "evaluate_call",
    "CallInput",
    "EvalResult",
    "EvalHit",
    "EvalConfig",
    "OutputShape",
    "LayerId",
    "CONDITION_REGISTRY",
    "ConditionDef",
    "describe",
]
