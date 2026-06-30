from __future__ import annotations

import asyncio
import tempfile
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, UploadFile

from api.models.analytics_schemas import (
    ArtifactResponse,
    ChatRequest,
    ChatResponse,
    ConfigureRequest,
    ConfigureResponse,
    GenerateSemanticResponse,
    GenerateSourcesResponse,
    GenerateStagingResponse,
    PipelineStateResponse,
    ResetResponse,
    TableInfo,
    UploadResponse,
)
from api.services import analytics_graph, dbt_runner, duckdb_manager
from api.services.llm_client import list_providers

router = APIRouter(prefix="/analytics", tags=["analytics"])

# In-memory store for the API key (never persisted to disk)
_llm_config: dict = {}


@router.get("/providers")
async def get_providers():
    return list_providers()


@router.post("/configure", response_model=ConfigureResponse)
async def configure(req: ConfigureRequest):
    _llm_config["provider"] = req.llm_provider
    _llm_config["api_key"] = req.llm_api_key
    _llm_config["model"] = req.llm_model

    state = analytics_graph.load_state()
    state["llm_provider"] = req.llm_provider
    state["llm_api_key"] = req.llm_api_key
    state["llm_model"] = req.llm_model
    analytics_graph.save_state(state)

    return ConfigureResponse(status="configured", provider=req.llm_provider)


@router.post("/upload", response_model=UploadResponse)
async def upload_files(files: list[UploadFile] = File(...)):
    loaded: list[TableInfo] = []
    for f in files:
        if not f.filename or not f.filename.lower().endswith(".csv"):
            raise HTTPException(400, f"Only CSV files are supported: {f.filename}")

        content = await f.read()
        if len(content) > 100 * 1024 * 1024:
            raise HTTPException(413, f"File too large: {f.filename}")

        with tempfile.NamedTemporaryFile(suffix=".csv", delete=False) as tmp:
            tmp.write(content)
            tmp_path = tmp.name

        try:
            info = await asyncio.to_thread(
                duckdb_manager.load_csv_to_table, tmp_path, f.filename
            )
            loaded.append(TableInfo(**info))
        finally:
            Path(tmp_path).unlink(missing_ok=True)

    state = analytics_graph.load_state()
    state["tables"] = [t.model_dump() for t in loaded]
    state["current_step"] = 2
    state["error"] = None
    analytics_graph.save_state(state)

    return UploadResponse(tables=loaded)


@router.post("/generate-sources", response_model=GenerateSourcesResponse)
async def generate_sources():
    state = analytics_graph.load_state()
    _inject_api_key(state)

    state = await asyncio.to_thread(analytics_graph.generate_sources, state)

    return GenerateSourcesResponse(
        sources_yaml=state.get("sources_yaml", ""),
        status=state["sources_status"],
        error=state.get("error"),
    )


@router.post("/generate-staging", response_model=GenerateStagingResponse)
async def generate_staging():
    state = analytics_graph.load_state()
    _inject_api_key(state)

    state = await asyncio.to_thread(analytics_graph.generate_staging, state)

    return GenerateStagingResponse(
        staging_models=state.get("staging_models", {}),
        dbt_log=state.get("staging_dbt_log", ""),
        status=state["staging_status"],
        error=state.get("error"),
    )


@router.post("/generate-semantic", response_model=GenerateSemanticResponse)
async def generate_semantic():
    state = analytics_graph.load_state()
    _inject_api_key(state)

    state = await asyncio.to_thread(analytics_graph.generate_semantic_layer, state)

    return GenerateSemanticResponse(
        semantic_layer=state.get("semantic_layer", {}),
        status=state["semantic_status"],
        error=state.get("error"),
    )


@router.post("/chat", response_model=ChatResponse)
async def chat_endpoint(req: ChatRequest):
    state = analytics_graph.load_state()
    _inject_api_key(state)

    result = await asyncio.to_thread(analytics_graph.chat, state, req.message)

    return ChatResponse(
        response=result["response"],
        sql=result.get("sql"),
        data=result.get("data"),
        chart=result.get("chart"),
    )


@router.get("/state", response_model=PipelineStateResponse)
async def get_state():
    state = analytics_graph.get_public_state()
    tables_raw = state.get("tables", [])
    tables = [TableInfo(**t) if isinstance(t, dict) else t for t in tables_raw]

    return PipelineStateResponse(
        current_step=state.get("current_step", 1),
        tables=tables,
        sources_yaml=state.get("sources_yaml", ""),
        sources_status=state.get("sources_status", "pending"),
        staging_models=state.get("staging_models", {}),
        staging_status=state.get("staging_status", "pending"),
        staging_dbt_log=state.get("staging_dbt_log", ""),
        semantic_layer=state.get("semantic_layer", {}),
        semantic_status=state.get("semantic_status", "pending"),
        messages=state.get("messages", []),
        error=state.get("error"),
    )


@router.get("/tables")
async def get_tables():
    tables = await asyncio.to_thread(duckdb_manager.list_tables)
    return [TableInfo(**t) for t in tables]


@router.get("/artifacts/{artifact_type}", response_model=ArtifactResponse)
async def get_artifact(artifact_type: str):
    if artifact_type not in ("sources", "staging", "semantic"):
        raise HTTPException(400, f"Invalid artifact type: {artifact_type}")
    content = dbt_runner.get_artifact(artifact_type)
    return ArtifactResponse(content=content)


@router.get("/system-prompt")
async def get_system_prompt():
    state = analytics_graph.load_state()
    prompt = analytics_graph._build_system_prompt(state)
    return {"system_prompt": prompt}


@router.post("/reset", response_model=ResetResponse)
async def reset():
    _llm_config.clear()
    await asyncio.to_thread(analytics_graph.reset_pipeline)
    return ResetResponse(status="reset")


def _inject_api_key(state: analytics_graph.PipelineState) -> None:
    if not state.get("llm_api_key") and _llm_config.get("api_key"):
        state["llm_provider"] = _llm_config.get("provider", state.get("llm_provider", ""))
        state["llm_api_key"] = _llm_config["api_key"]
        state["llm_model"] = _llm_config.get("model", state.get("llm_model"))
    if not state.get("llm_api_key"):
        raise HTTPException(401, "API key not configured. Please set your LLM API key.")
