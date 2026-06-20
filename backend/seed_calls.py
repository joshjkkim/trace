"""Load seed/calls-test-data.json into Supabase CALLS. No server needed."""
import json
from pathlib import Path

from schemas.trace import IngestPayload
from services.trace_service import ingest_trace

SEED_FILE = Path(__file__).resolve().parent.parent / "seed" / "calls-test-data.json"


def main() -> None:
    rows = json.loads(SEED_FILE.read_text())
    for row in rows:
        payload = IngestPayload(**row)
        call_id = ingest_trace(payload)
        print(f"inserted CALLS.id={call_id} step={payload.step_name} run_id={payload.run_id}")


if __name__ == "__main__":
    main()
