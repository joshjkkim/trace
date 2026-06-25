"""Core types for the anomaly scoring model.

Pure data shapes — no DB, no FastAPI, no backend imports. `CallInput` mirrors
the backend CALLS ingest fields but is owned by this package so the model stays
standalone (see anomaly_package_plan).
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

# Where a condition lives. Stable strings — also used in EvalResult.stopped_at_layer.
LayerId = Literal["L1_hard", "L2_format", "L4_integers", "L5_statistical"]

# Coarse shape classification — used by L4 cross-field checks and EvalResult UI fields.
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
    """IQR-based stats for one numeric metric over a step profile's recent history.

    Uses log-transformed IQR for latency/cost/tokens — all positive, right-skewed
    metrics that don't satisfy z-score's normality assumption. Detection is via the
    Tukey fence: a value is anomalous when it falls outside [Q1 - k*IQR, Q3 + k*IQR]
    (in log space when log_transform=True), where k is EvalConfig.iqr_fence_k.
    """

    count: int
    log_transform: bool = False  # True for latency, cost, tokens (always positive)

    # Raw-space percentiles (always populated)
    q1: float
    median: float
    q3: float
    iqr: float   # q3 - q1

    # Log-space percentiles (populated when log_transform=True)
    log_q1: float | None = None
    log_q3: float | None = None
    log_iqr: float | None = None

    def iqr_deviation(self, observed: float, k: float = 2.5) -> float | None:
        """Signed deviation outside the Tukey fence, measured in IQR widths.

        Returns None  — observed is within the fence (not anomalous).
        Positive float — observed is above the upper fence.
        Negative float — observed is below the lower fence.

        When log_transform=True the fence is computed in log space so the test
        is multiplicative: 'is this 3× higher than the 75th percentile?' rather
        than 'is this 500ms above the 75th percentile?'
        """
        if self.log_transform and self.log_q1 is not None and self.log_q3 is not None and self.log_iqr is not None:
            import math
            if observed <= 0:
                return None
            val  = math.log(observed)
            iq   = self.log_iqr
            lo   = self.log_q1 - k * iq
            hi   = self.log_q3 + k * iq
        else:
            val  = observed
            iq   = self.iqr
            lo   = self.q1 - k * iq
            hi   = self.q3 + k * iq

        if iq < 1e-9:
            return None
        if val > hi:
            return (val - hi) / iq
        if val < lo:
            return (val - lo) / iq
        return None


class StepBaseline(BaseModel):
    """Per-step-profile IQR baseline, computed from recent call history.

    All four MetricStat objects use log_transform=True because every metric is
    positive and right-skewed (LLM latency / token / cost distributions are
    well-modelled as log-normal). None metrics mean not enough clean samples.
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

    # Optional UI/debug shape fields — populated by shape_classifier in evaluate_call.
    prompt_shape: OutputShape | None = None
    output_shape: OutputShape | None = None

    @property
    def clean(self) -> bool:
        return not self.triggered
