"""Stable registry of every condition that can fire.

Each `if`-branch in a layer references a unique integer code. The UI maps a code
to a human label/penalty without parsing Python. Penalties live here, not
scattered in the layer files — layers only reference codes via `describe()`.

Code ranges:
    L1 hard        1001-1099
    L2 format      2001-2099   (regex / contract violations)
    L3 fingerprint 3001-3099   (shape + structural features)
    L4 integers    4001-4099   (static thresholds + cross-field)
"""

from __future__ import annotations

from dataclasses import dataclass

from .schemas import LayerId


@dataclass(frozen=True)
class ConditionDef:
    code: int
    layer: LayerId
    name: str            # stable snake_case id
    penalty: float       # contribution to total_score if fired
    description: str      # UI tooltip / dashboard copy
    if_ref: str           # which if-branch in code (dev reference)


# --- L1 hard: deterministic, non-heuristic failures. Each penalty == threshold
# (100) so any single hard hit short-circuits at L1. ---
_L1: list[ConditionDef] = [
    ConditionDef(
        1001, "L1_hard", "status_failure", 100.0,
        "Call reported status_success=False.",
        "layer_1_hard.run_layer_1_hard:status",
    ),
    ConditionDef(
        1002, "L1_hard", "error_present", 100.0,
        "Call carries a non-empty error message.",
        "layer_1_hard.run_layer_1_hard:error",
    ),
    ConditionDef(
        1003, "L1_hard", "empty_output_on_success", 100.0,
        "Call succeeded but produced no output_code.",
        "layer_1_hard.run_layer_1_hard:empty_output",
    ),
    ConditionDef(
        1004, "L1_hard", "negative_tokens", 100.0,
        "A token count (input/output/reasoning/total) is negative.",
        "layer_1_hard.run_layer_1_hard:negative_tokens",
    ),
    ConditionDef(
        1005, "L1_hard", "negative_latency", 100.0,
        "latency_ms is negative.",
        "layer_1_hard.run_layer_1_hard:negative_latency",
    ),
    ConditionDef(
        1006, "L1_hard", "negative_cost", 100.0,
        "cost is negative.",
        "layer_1_hard.run_layer_1_hard:negative_cost",
    ),
    ConditionDef(
        1007, "L1_hard", "token_accounting_mismatch", 100.0,
        "total_tokens does not equal input + output + reasoning tokens.",
        "layer_1_hard.run_layer_1_hard:token_accounting",
    ),
    ConditionDef(
        1008, "L1_hard", "missing_required_field", 100.0,
        "A required identity field (step_name/model/prompt/run_id) is blank.",
        "layer_1_hard.run_layer_1_hard:missing_field",
    ),
]

# --- L2 format: prompt-implied output contracts (JSON / enum / yes-no). The
# prompt declares a shape; the output must honor it. Detected via regex +
# json parsing in layer_2_regex. ---
_L2: list[ConditionDef] = [
    ConditionDef(
        2001, "L2_format", "json_contract_violation", 50.0,
        "Prompt asks for JSON but output_code is not parseable JSON.",
        "layer_2_regex.run_layer_2_regex:json_contract",
    ),
    ConditionDef(
        2002, "L2_format", "json_strict_violation", 60.0,
        "Prompt demands only JSON but output has code fences or surrounding prose.",
        "layer_2_regex.run_layer_2_regex:json_strict",
    ),
    ConditionDef(
        2003, "L2_format", "enum_contract_violation", 35.0,
        "Prompt enumerates allowed answers but output is not one of them.",
        "layer_2_regex.run_layer_2_regex:enum_contract",
    ),
    ConditionDef(
        2004, "L2_format", "yes_no_contract_violation", 25.0,
        "Prompt asks a yes/no question but output is not a bare yes or no.",
        "layer_2_regex.run_layer_2_regex:yes_no_contract",
    ),
]

# --- L3 fingerprint: heuristic shape + structural feature checks (no ML, no
# history). Compares inferred expected shape against the classified output shape
# and inspects structure (brackets, keys, word/length ratios). ---
_L3: list[ConditionDef] = [
    ConditionDef(
        3010, "L3_fingerprint", "word_count_exceeded", 20.0,
        "Prompt capped the answer length (e.g. 'one word') but output is longer.",
        "layer_3_fingerprinting.run_layer_3_fingerprinting:word_count",
    ),
    ConditionDef(
        3011, "L3_fingerprint", "bracket_imbalance", 25.0,
        "Output has unbalanced {} or [] brackets (malformed structure).",
        "layer_3_fingerprinting.run_layer_3_fingerprinting:bracket_balance",
    ),
    ConditionDef(
        3012, "L3_fingerprint", "json_key_missing", 30.0,
        "Keys named in the prompt's JSON example are missing from the output.",
        "layer_3_fingerprinting.run_layer_3_fingerprinting:json_keys",
    ),
    ConditionDef(
        3013, "L3_fingerprint", "output_bloat_ratio", 20.0,
        "Output is far larger than the prompt for a classify/enum-style step.",
        "layer_3_fingerprinting.run_layer_3_fingerprinting:bloat_ratio",
    ),
    ConditionDef(
        3014, "L3_fingerprint", "prompt_output_shape_mismatch", 30.0,
        "Classified output shape does not match the shape implied by the prompt.",
        "layer_3_fingerprinting.run_layer_3_fingerprinting:shape_mismatch",
    ),
]

# --- L4 integers: static numeric limits plus cross-field plausibility. Reads
# limits / step_limits from EvalConfig and shape hints from shape_classifier.
# Penalties are individually small — several must fire to cross threshold. ---
_L4: list[ConditionDef] = [
    ConditionDef(
        4001, "L4_integers", "latency_threshold", 15.0,
        "latency_ms exceeds the configured maximum.",
        "layer_4_integers.run_layer_4_integers:latency",
    ),
    ConditionDef(
        4002, "L4_integers", "tokens_threshold", 15.0,
        "total_tokens exceeds the configured maximum.",
        "layer_4_integers.run_layer_4_integers:tokens",
    ),
    ConditionDef(
        4003, "L4_integers", "cost_threshold", 15.0,
        "cost exceeds the configured maximum.",
        "layer_4_integers.run_layer_4_integers:cost",
    ),
    ConditionDef(
        4004, "L4_integers", "token_ratio_anomaly", 10.0,
        "output_tokens / input_tokens exceeds the configured ratio.",
        "layer_4_integers.run_layer_4_integers:token_ratio",
    ),
    ConditionDef(
        4005, "L4_integers", "classify_step_token_bloat", 25.0,
        "A classify/intent step produced far more output tokens than expected.",
        "layer_4_integers.run_layer_4_integers:classify_bloat",
    ),
    ConditionDef(
        4006, "L4_integers", "short_step_output_bloat", 20.0,
        "A short-answer (enum) step produced more output tokens than expected.",
        "layer_4_integers.run_layer_4_integers:short_bloat",
    ),
    ConditionDef(
        4007, "L4_integers", "high_latency_low_output", 20.0,
        "High latency paired with almost no output tokens.",
        "layer_4_integers.run_layer_4_integers:latency_low_output",
    ),
    ConditionDef(
        4008, "L4_integers", "json_step_token_bloat", 20.0,
        "A JSON-expected step produced an implausibly large token count.",
        "layer_4_integers.run_layer_4_integers:json_bloat",
    ),
    ConditionDef(
        4009, "L4_integers", "chars_per_token_suspicious", 15.0,
        "Output characters per token fall outside the plausible range.",
        "layer_4_integers.run_layer_4_integers:chars_per_token",
    ),
    ConditionDef(
        4010, "L4_integers", "zero_output_tokens_with_body", 25.0,
        "output_tokens is zero but output_code is non-empty.",
        "layer_4_integers.run_layer_4_integers:zero_tokens_body",
    ),
]

# --- L5 statistical: z-score deviations from per-step-profile baselines.
# Only fires when a StepBaseline is available for the current step (≥20 samples).
# Owns latency/tokens/cost when active — L4's 4001/4002/4003 defer to these. ---
_L5: list[ConditionDef] = [
    ConditionDef(
        5001, "L5_statistical", "latency_zscore",  30.0,
        "Call latency deviates more than 3σ from this step's historical mean.",
        "layer_5_statistical.run_layer_5_statistical:latency_zscore",
    ),
    ConditionDef(
        5002, "L5_statistical", "tokens_zscore", 25.0,
        "Total tokens deviate more than 3σ from this step's historical mean.",
        "layer_5_statistical.run_layer_5_statistical:tokens_zscore",
    ),
    ConditionDef(
        5003, "L5_statistical", "cost_zscore", 20.0,
        "Call cost deviates more than 3σ from this step's historical mean.",
        "layer_5_statistical.run_layer_5_statistical:cost_zscore",
    ),
    ConditionDef(
        5004, "L5_statistical", "output_tokens_zscore", 20.0,
        "Output tokens deviate more than 3σ from this step's historical mean.",
        "layer_5_statistical.run_layer_5_statistical:output_tokens_zscore",
    ),
]

CONDITION_REGISTRY: dict[int, ConditionDef] = {
    c.code: c for c in (*_L1, *_L2, *_L3, *_L4, *_L5)
}


def describe(code: int) -> ConditionDef:
    """Look up a condition definition by code. Raises KeyError if unregistered."""
    return CONDITION_REGISTRY[code]
