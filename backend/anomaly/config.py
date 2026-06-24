"""Evaluation config — thresholds, static limits, optional penalty overrides.

Penalties themselves live in condition_registry.py. `penalty_overrides` lets a
caller tune a specific code without editing the registry.
"""

from __future__ import annotations

from pydantic import BaseModel, Field

from .schemas import StepBaseline


class EvalConfig(BaseModel):
    threshold: float = 100.0
    # code -> penalty, overrides the registry value for that code when present.
    penalty_overrides: dict[int, float] = Field(default_factory=dict)

    # Per-step statistical baseline (L5). When present, L5 scores latency/tokens/
    # cost as z-scores against this step's own history, and L4 defers its raw
    # threshold checks (4001/4002/4003) to avoid double-counting the same metric.
    baseline: StepBaseline | None = None

    # z-score magnitude beyond which an L5 metric deviation fires.
    zscore_threshold: float = 3.0

    # Static numeric limits — consumed by L4 later. Defined now so config shape
    # is stable across layers.
    limits: dict[str, float] = Field(
        default_factory=lambda: {
            "latency_ms_max": 10_000,
            "total_tokens_max": 50_000,
            "cost_max": 1.0,
            "output_input_ratio_max": 50.0,
            "max_len_ratio_classify": 20.0,
            "chars_per_token_min": 2.0,
            "chars_per_token_max": 8.0,
        }
    )
    step_limits: dict[str, dict[str, float]] = Field(
        default_factory=lambda: {
            "classify": {"max_output_tokens": 50, "max_latency_ms": 2000},
            "proofread": {"max_output_tokens": 100, "max_latency_ms": 3000},
            "draft": {"max_output_tokens": 2000, "max_latency_ms": 15_000},
        }
    )

    def penalty_for(self, code: int, default: float) -> float:
        """Resolved penalty for a code: override if set, else the registry default."""
        return self.penalty_overrides.get(code, default)
