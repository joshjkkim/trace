"""Pricing table for cost calculation — mirrors sdk/src/cost.ts."""

from __future__ import annotations

_PRICING: dict[str, tuple[float, float]] = {
    # (input_per_1m_usd, output_per_1m_usd)
    # Anthropic
    "claude-opus-4-8":                  (15.0,  75.0),
    "claude-opus-4-8-20251101":         (15.0,  75.0),
    "claude-sonnet-4-6":                (3.0,   15.0),
    "claude-sonnet-4-6-20251001":       (3.0,   15.0),
    "claude-haiku-4-5":                 (0.8,   4.0),
    "claude-haiku-4-5-20251001":        (0.8,   4.0),
    "claude-3-5-sonnet-20241022":       (3.0,   15.0),
    "claude-3-5-haiku-20241022":        (0.8,   4.0),
    "claude-3-opus-20240229":           (15.0,  75.0),
    # OpenAI
    "gpt-4o":                           (2.5,   10.0),
    "gpt-4o-2024-11-20":                (2.5,   10.0),
    "gpt-4o-mini":                      (0.15,  0.6),
    "gpt-4o-mini-2024-07-18":           (0.15,  0.6),
    "gpt-4-turbo":                      (10.0,  30.0),
    "gpt-4":                            (30.0,  60.0),
    "gpt-3.5-turbo":                    (0.5,   1.5),
    "o1":                               (15.0,  60.0),
    "o1-mini":                          (3.0,   12.0),
    "o3-mini":                          (1.1,   4.4),
}


def get_cost(model: str, input_tokens: int, output_tokens: int) -> float:
    pricing = _PRICING.get(model)
    if not pricing:
        return 0.0
    input_per_1m, output_per_1m = pricing
    return (input_tokens / 1_000_000) * input_per_1m + (output_tokens / 1_000_000) * output_per_1m
