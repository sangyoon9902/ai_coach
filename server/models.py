from typing import Optional, Dict, Any
from pydantic import BaseModel, Field

class User(BaseModel):
    name: Optional[str] = ""
    sex: Optional[str] = Field(default="M", pattern="^(M|F)$")

    age: Optional[int] = 0
    height_cm: Optional[float] = 0
    weight_kg: Optional[float] = 0
    bmi: Optional[float] = None
    goal: Optional[str] = None  # 있으면 받아줌

class Measurements(BaseModel):
    situp_reps: int = 0
    reach_cm: float = 0
    step_recovery_bpm: Optional[float] = None
    step_vo2max: Optional[float] = None

class NormalizedPayload(BaseModel):
    user: User
    measurements: Measurements
    surveys: Dict[str, Any] = {}
