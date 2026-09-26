"""
schemas.py — All Pydantic request/response models for the Training Module API.
"""
from pydantic import BaseModel, Field, field_validator
from typing import List, Optional, Dict, Any


ALLOWED_LANGUAGES = {"english", "urdu"}


def _validate_tensor_shape(tensor: Optional[List[List[List[float]]]], field_name: str):
    if tensor is None:
        return None

    if len(tensor) != 3:
        raise ValueError(f"{field_name} must have shape (3, 64, 9).")

    for pos_slice in tensor:
        if len(pos_slice) != 64:
            raise ValueError(f"{field_name} must have shape (3, 64, 9).")
        for err_vector in pos_slice:
            if len(err_vector) != 9:
                raise ValueError(f"{field_name} must have shape (3, 64, 9).")

    return tensor





class UserStats(BaseModel):
    severity: float = Field(ge=0.0, le=1.0)
    fatigue: float = Field(ge=0.0, le=1.0)
    age: float = Field(ge=0.0, le=1.0)
    delta: float = Field(ge=-1.0, le=1.0)


class StrategyGeneratePayload(BaseModel):
    current_tensor: List[List[List[float]]]
    user_stats: UserStats
    force_easier: bool = False
    language: str = "english"

    @field_validator("current_tensor")
    @classmethod
    def validate_strategy_tensor(cls, value):
        checked = _validate_tensor_shape(value, "current_tensor")
        if checked is None:
            raise ValueError("current_tensor is required.")
        return checked

    @field_validator("language")
    @classmethod
    def normalize_language(cls, value: str) -> str:
        lang = value.strip().lower()
        if lang not in ALLOWED_LANGUAGES:
            raise ValueError("language must be 'english' or 'urdu'.")
        return lang
