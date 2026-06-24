"""Core types for the anomaly scoring model.

Pure data shapes — no DB, no FastAPI, no backend imports. `CallInput` mirrors
the backend CALLS ingest fields but is owned by this package so the model stays
standalone (see anomaly_package_plan).
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

# Where a condition lives. Stable strings — also used in EvalResult.stopped_at_layer.
LayerId = Literal["L1_hard", "L2_format", "L3_fingerprint", "L4_integers", "L5_statistical"]

# Dumb-down classification of a prompt or output blob (used by L3 later).
OutputShape = Literal[
    "empty", "json", "code", "prose", "enum_short",
    "list", "markdown", "number", "unknown",
]


class CallInput(BaseModel):
    """One traced call. Same fields as the backend IngestPayload, redefined here
    so the anomaly package never imports backend code."""

    step_name: str
    model: str
    prompt: str = Field(..., description="Exact user prompt string")
    input_tokens: int | None = None
    output_tokens: int | None = None
    reasoning_tokens: int | None = None
    total_tokens: int | None = None
    latency_ms: int
    cost: float | None = None
    status_success: bool = True
    error: str | None = None
    output_code: str | None = None
    run_id: str
    project_id: str | None = None


class MetricStat(BaseModel):
    """Mean/stddev for one numeric metric over a step profile's recent history."""

    mean: float
    std: float
    count: int

    def zscore(self, observed: float) -> float | None:
        """z = (observed - mean) / std. None when std is ~0 (no spread to judge)."""
        if self.std < 1e-9:
            return None
        return (observed - self.mean) / self.std


class StepBaseline(BaseModel):
    """Per-step-profile statistical baseline, computed from recent call history.

    Injected into EvalConfig so the L5 layer can score a call against the normal
    behavior of *its own step* rather than a project-wide limit. None metrics mean
    not enough samples for that field.
    """

    sample_count: int
    latency_ms: MetricStat | None = None
    total_tokens: MetricStat | None = None
    output_tokens: MetricStat | None = None
    cost: MetricStat | None = None


class EvalHit(BaseModel):
    """One fired condition. Only bad rules produce hits — clean calls have none."""

    condition_code: int
    layer: LayerId
    rule_name: str
    step_name: str | None = None
    run_id: str | None = None
    penalty: float
    message: str
    observed: object | None = None
    expected: object | None = None


class EvalResult(BaseModel):
    """Full report for one evaluation.

    `error_map` maps condition_code -> penalty for every fired condition; it is
    `{}` and `hits` is `[]` when the call is clean. `total_score` is the sum of
    the penalties that fired.
    """

    triggered: bool
    total_score: float
    threshold: float
    stopped_at_layer: LayerId | None = None
    hits: list[EvalHit] = Field(default_factory=list)
    error_map: dict[int, float] = Field(default_factory=dict)

    # Optional UI/debug fingerprint fields (populated by L3 later).
    prompt_shape: OutputShape | None = None
    output_shape: OutputShape | None = None

    @property
    def clean(self) -> bool:
        return not self.triggered
