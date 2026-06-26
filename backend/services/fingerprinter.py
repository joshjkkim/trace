"""
Step fingerprinting — semantic identity for LLM calls.

On every ingest, extract the stable instruction part of the prompt, embed it
with a local sentence-transformers model, and match against known step profiles
for this project using pgvector cosine similarity.

Three outcomes:
  matched  — similarity > 0.92, same step, use existing profile
  evolved  — similarity 0.75–0.92, same step but drifting, keep profile + log
  new      — similarity < 0.75, genuinely new step, create profile
"""

import json
import threading
from functools import lru_cache

from db import get_client

MATCH_THRESHOLD  = 0.92
EVOLVED_THRESHOLD = 0.75

# Model is loaded once and reused — ~80MB, loads in ~1s on first call
@lru_cache(maxsize=1)
def _get_model():
    from sentence_transformers import SentenceTransformer
    return SentenceTransformer("all-MiniLM-L6-v2")

_model_lock = threading.Lock()


def _embed(text: str) -> list[float]:
    with _model_lock:
        model = _get_model()
    return model.encode(text, normalize_embeddings=True).tolist()


def _extract_kernel(prompt_json: str) -> str:
    """Pull the stable instruction part out of the prompt JSON.

    Supports two formats:
      TS SDK:  {"system": "...", "messages": [...]}
      LangChain/Python: {"messages": [{"role": "system", ...}, ...]}
    The system prompt is the stable identity of a step; user messages vary per call.
    """
    try:
        obj = json.loads(prompt_json)
        if isinstance(obj, dict):
            # TS SDK format — top-level system field
            if obj.get("system"):
                return str(obj["system"])[:500]
            msgs = obj.get("messages", [])
            # LangChain format — system message inside messages array
            for msg in msgs:
                if isinstance(msg, dict) and msg.get("role") == "system":
                    content = msg.get("content", "")
                    text = content if isinstance(content, str) else str(content)
                    return text[:500]
            # Fallback: first user message
            for msg in msgs:
                if isinstance(msg, dict) and msg.get("role") == "user":
                    content = msg.get("content", "")
                    text = content if isinstance(content, str) else str(content)
                    return text[:200]
    except (ValueError, TypeError):
        pass
    return prompt_json[:200]


def _derive_step_name(prompt_json: str) -> str | None:
    """Auto-generate a readable step name from the system prompt if no name was given."""
    try:
        obj = json.loads(prompt_json)
        system = obj.get("system") if isinstance(obj, dict) else None
        if not system:
            return None
        words = str(system).split()[:4]
        slug = "-".join(words).lower()
        slug = "".join(c if c.isalnum() or c == "-" else "" for c in slug)
        return slug[:40] or None
    except (ValueError, TypeError):
        return None


def match_or_create_profile(
    project_id: str,
    step_name: str,
    prompt_json: str,
) -> tuple[str | None, str]:
    """
    Returns (step_profile_id, status) where status is 'matched', 'evolved', or 'new'.
    Returns (None, 'error') if anything fails — ingest should continue regardless.
    """
    try:
        kernel = _extract_kernel(prompt_json)
        embedding = _embed(kernel)
        db = get_client()

        # pgvector nearest-neighbour search within this project
        result = db.rpc("match_step_profile", {
            "p_project_id":   project_id,
            "p_embedding":    embedding,
            "p_threshold":    EVOLVED_THRESHOLD,
        }).execute()

        if result.data:
            match = result.data[0]
            similarity = match["similarity"]
            profile_id = match["id"]

            status = "matched" if similarity >= MATCH_THRESHOLD else "evolved"

            updates: dict = {"step_name": step_name, "last_seen_at": "now()"}
            if status == "evolved":
                updates["last_evolved_at"] = "now()"
                print(f"[fingerprint] step evolved: {step_name} similarity={similarity:.3f} — baseline reset")

            db.table("step_profiles").update(updates).eq("id", profile_id).execute()
            return profile_id, status

        # No match — create new profile
        display_name = step_name if not step_name.startswith("step_") else (
            _derive_step_name(prompt_json) or step_name
        )
        res = db.table("step_profiles").insert({
            "project_id":  project_id,
            "fingerprint": embedding,
            "step_name":   display_name,
        }).execute()

        profile_id = res.data[0]["id"]
        print(f"[fingerprint] new step profile: {display_name} id={profile_id}")
        return profile_id, "new"

    except Exception as exc:
        print(f"[fingerprint] failed for project={project_id} step={step_name}: {exc}")
        return None, "error"
