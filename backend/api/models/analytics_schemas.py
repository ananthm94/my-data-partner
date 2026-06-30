from __future__ import annotations

from pydantic import BaseModel


class ConfigureRequest(BaseModel):
    llm_provider: str
    llm_api_key: str
    llm_model: str | None = None


class ConfigureResponse(BaseModel):
    status: str
    provider: str


class ColumnInfo(BaseModel):
    name: str
    type: str


class TableInfo(BaseModel):
    name: str
    row_count: int
    columns: list[ColumnInfo]


class UploadResponse(BaseModel):
    tables: list[TableInfo]


class GenerateSourcesResponse(BaseModel):
    sources_yaml: str
    status: str
    error: str | None = None


class GenerateStagingResponse(BaseModel):
    staging_models: dict[str, str]
    dbt_log: str
    status: str
    error: str | None = None


class GenerateSemanticResponse(BaseModel):
    semantic_layer: dict
    status: str
    error: str | None = None


class ChatRequest(BaseModel):
    message: str


class ChartSpec(BaseModel):
    chart_type: str
    title: str
    x_key: str
    y_key: str
    data: list[dict]


class ChatResponse(BaseModel):
    response: str
    sql: str | None = None
    data: list[dict] | None = None
    chart: ChartSpec | None = None
    error: str | None = None


class PipelineStateResponse(BaseModel):
    current_step: int
    tables: list[TableInfo]
    sources_yaml: str
    sources_status: str
    staging_models: dict[str, str]
    staging_status: str
    staging_dbt_log: str
    semantic_layer: dict
    semantic_status: str
    messages: list[dict]
    error: str | None = None


class ArtifactResponse(BaseModel):
    content: str | None


class ResetResponse(BaseModel):
    status: str
