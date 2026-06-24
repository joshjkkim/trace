from pydantic import BaseModel


class AnomalyInput(BaseModel):
    step_name: str
    run_id: str
    bad_scores: dict[str, int]  # { "error_code": penalty_score }


class AnomalyRecord(BaseModel):
    id: int
    step_name: str
    run_id: str
    project_id: str | None = None
    error_code: int
    penalty_score: int
    created_at: str
