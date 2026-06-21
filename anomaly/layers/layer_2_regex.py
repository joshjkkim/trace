"""Layer 2 — format / contract violations (the "regex" layer).

The prompt often declares the shape of the answer it wants ("respond in JSON",
"answer with one of: a, b, c", "yes/no question"). This layer infers that
contract with regex and checks the output honors it. It does NOT judge whether
the answer is correct — only whether it is the right *shape*.

Each branch references a condition code from condition_registry (2001-2004) and
appends an EvalHit. The evaluator turns hits into the error_map / total_score
and handles short-circuiting; this layer only detects.
"""

from __future__ import annotations

import json
import re

from condition_registry import describe
from config import EvalConfig
from schemas import CallInput, EvalHit


def _preview(text: str | None, limit: int = 80) -> str:
    s = (text or "").strip().replace("\n", " ")
    return s if len(s) <= limit else s[:limit] + "…"


def _is_json(text: str | None) -> bool:
    if not text or not text.strip():
        return False
    try:
        obj = json.loads(text.strip())
    except (ValueError, TypeError):
        return False
    return isinstance(obj, (dict, list))


def _enum_options(prompt: str) -> set[str]:
    """Pull an allowed-answer set out of phrasings like 'one of: a, b, c'.

    Only treated as an enum contract when an actual enumeration is present —
    at least two options separated by comma / 'or' / '/'. This avoids matching
    open-ended instructions like 'respond with just a number'.
    """
    m = re.search(r"(?:one of|choose from|respond with)\s*:?\s*([^.?\n]+)", prompt, re.I)
    if not m:
        return set()
    raw = re.split(r",|\bor\b|/", m.group(1))
    options = {opt.strip().strip("'\"").lower() for opt in raw if opt.strip()}
    return options if len(options) >= 2 else set()


def run_layer_2_regex(payload: CallInput, config: EvalConfig) -> list[EvalHit]:
    """Run all L2 contract checks. Returns fired hits (possibly empty)."""

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
    out = payload.output_code or ""
    p = prompt.lower()

    # 2001 / 2002 — JSON contract.
    if re.search(r"\bjson\b", p):
        if not _is_json(out):
            fire(2001, observed=_preview(out), expected="parseable JSON")
        elif re.search(r"only json|json only|valid json only|nothing but json", p):
            # Parseable, but a strict "only JSON" prompt forbids fences / prose.
            if "```" in out or not out.strip()[:1] in "{[":
                fire(2002, observed=_preview(out), expected="bare JSON, no fences/prose")

    # 2003 — enum contract.
    options = _enum_options(prompt)
    if options:
        answer = out.strip().strip(".!").lower()
        if answer not in options:
            fire(2003, observed=_preview(out), expected=sorted(options))

    # 2004 — yes/no contract.
    if re.search(r"yes\s*/\s*no|yes or no", p):
        answer = out.strip().strip(".!").lower()
        if answer not in {"yes", "no"}:
            fire(2004, observed=_preview(out), expected="yes | no")

    return hits
