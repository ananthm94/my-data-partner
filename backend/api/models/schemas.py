from __future__ import annotations

from typing import Any

from pydantic import BaseModel


class ColumnSchema(BaseModel):
    column_name: str
    inferred_type: str
    completeness_pct: float


class Metadata(BaseModel):
    total_rows: int
    total_columns: int
    file_size_mb: float


class UploadResponse(BaseModel):
    session_id: str
    metadata: Metadata
    schema_: list[ColumnSchema]

    class Config:
        populate_by_name = True


class SuggestRequest(BaseModel):
    session_id: str
    user_context: str = ""


class Suggestions(BaseModel):
    renames: dict[str, str] = {}
    type_casts: dict[str, str] = {}
    imputations: dict[str, str] = {}


class SuggestResponse(BaseModel):
    suggestions: Suggestions
    ai_available: bool = True
    message: str | None = None


class ApplyRequest(BaseModel):
    session_id: str
    renames: dict[str, str] = {}
    type_casts: dict[str, str] = {}
    imputations: dict[str, str] = {}


class ApplyResponse(BaseModel):
    success: bool


class GlobalProfileResponse(BaseModel):
    duplicate_rows: int
    correlation_matrix: dict[str, dict[str, Any]]


class ColumnProfileResponse(BaseModel):
    column_name: str
    data_type: str
    total: int
    missing: int
    missing_pct: float
    unique: int
    stats: dict[str, Any] | None = None
    distribution_data: list[dict[str, Any]] | None = None
    frequency_data: list[dict[str, Any]] | None = None
    word_frequency: list[dict[str, Any]] | None = None


class RelationshipResponse(BaseModel):
    correlation: dict[str, float]
    regression: dict[str, float]
    scatter_data: list[dict[str, Any]]


class PreviewResponse(BaseModel):
    head: list[dict[str, Any]]
    tail: list[dict[str, Any]]
    sample: list[dict[str, Any]]
    columns: list[str]


class JoinRequest(BaseModel):
    left_session_id: str
    right_session_id: str
    left_keys: list[str]
    right_keys: list[str]
    how: str = "inner"


class JoinResponse(BaseModel):
    session_id: str
    total_rows: int
    total_columns: int


class CustomFieldRequest(BaseModel):
    session_id: str
    column_name: str
    expression: str


class CustomFieldPreviewResponse(BaseModel):
    preview_values: list[Any]


class CleanRequest(BaseModel):
    session_id: str
    action: str
    column: str | None = None


class CleanResponse(BaseModel):
    session_id: str
    rows_before: int
    rows_after: int
    columns_before: int
    columns_after: int
