"""Shared, hardcoded shape heuristics for L3 and L4.

No ML, no DB history — just deterministic string inspection. L3 uses these to
compare the prompt's implied shape against the actual output shape and to read
structural features; L4 reuses the same inferred shape for cross-field checks so
the logic lives in exactly one place.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field

from schemas import OutputShape


def classify_shape(text: str | None) -> OutputShape:
    """Best-effort dumb-down of a blob into one of the OutputShape labels."""
    if text is None:
        return "empty"
    s = text.strip()
    if not s:
        return "empty"

    # JSON: only trust it if it actually parses into an object/array.
    if s[0] in "{[":
        try:
            obj = json.loads(s)
            if isinstance(obj, (dict, list)):
                return "json"
        except (ValueError, TypeError):
            pass

    if s.startswith("```") or re.search(r"\bdef \b|\bclass \b|=>|;\s*\n|^\s*import ", s, re.M):
        return "code"

    if re.fullmatch(r"[-+]?\d+(\.\d+)?", s):
        return "number"

    if re.match(r"^\s*([-*]|\d+\.)\s", s):
        return "list"

    if re.search(r"^#{1,6}\s|\[.+\]\(.+\)|\*\*.+\*\*", s, re.M):
        return "markdown"

    # Short, single-clause answers — the shape an enum / yes-no step should emit.
    words = s.split()
    if len(words) <= 3 and len(s) <= 40 and "\n" not in s:
        return "enum_short"

    return "prose"


def infer_expected_shape(prompt: str | None) -> OutputShape | None:
    """Infer the shape the prompt is asking for. None means no strong signal."""
    if not prompt:
        return None
    p = prompt.lower()
    if re.search(r"\bjson\b", p):
        return "json"
    if re.search(r"how many|how much|\bnumber\b|\bcount\b", p):
        return "number"
    if re.search(r"yes\s*/\s*no|yes or no", p):
        return "enum_short"
    if re.search(r"one of|choose from|classif|category|\blabel\b|pick one", p):
        return "enum_short"
    if re.search(r"\blist\b|bullet point", p):
        return "list"
    if re.search(r"markdown", p):
        return "markdown"
    return None


def word_cap(prompt: str | None) -> int | None:
    """If the prompt caps answer length, return the cap; else None.

    Handles 'one word', 'single word', 'in N words', 'at most N words'.
    """
    if not prompt:
        return None
    p = prompt.lower()
    if re.search(r"\b(one|single)\s+word\b", p):
        return 1
    m = re.search(r"(\d+)\s+words?\b", p)
    if m:
        return int(m.group(1))
    return None


@dataclass(frozen=True)
class StructFeatures:
    """Structural features computed over a single blob (usually the output)."""

    word_count: int
    line_count: int
    curly_balance: int          # count('{') - count('}'); 0 means balanced
    square_balance: int         # count('[') - count(']'); 0 means balanced
    json_keys: set[str] = field(default_factory=set)
    char_count: int = 0

    @property
    def bracket_imbalance(self) -> bool:
        return self.curly_balance != 0 or self.square_balance != 0


def extract_struct_features(text: str | None) -> StructFeatures:
    """Compute structural features for a blob. Empty text → all-zero features."""
    if not text:
        return StructFeatures(0, 0, 0, 0, set(), 0)

    keys: set[str] = set()
    try:
        obj = json.loads(text.strip())
        if isinstance(obj, dict):
            keys = {str(k) for k in obj.keys()}
    except (ValueError, TypeError):
        pass

    return StructFeatures(
        word_count=len(text.split()),
        line_count=text.count("\n") + 1,
        curly_balance=text.count("{") - text.count("}"),
        square_balance=text.count("[") - text.count("]"),
        json_keys=keys,
        char_count=len(text),
    )


def keys_named_in_prompt(prompt: str | None) -> set[str]:
    """Extract quoted JSON keys mentioned in the prompt's example, e.g. "name"."""
    if not prompt:
        return set()
    return set(re.findall(r'"(\w+)"', prompt))
