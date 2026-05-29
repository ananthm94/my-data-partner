from __future__ import annotations

from fastapi import APIRouter, HTTPException

from api.models.schemas import (
    ApplyRequest, ApplyResponse,
    DropColumnsRequest, ImputeRequest, MutateRequest, ShapeResponse,
    SuggestRequest, SuggestResponse, Suggestions,
    WorkspaceJoinRequest, WorkspaceJoinResponse,
)
from api.services import claude_client, eda_engine, session as session_svc
from api.services import workspace as workspace_svc

router = APIRouter()


def _load(session_id: str):
    try:
        return session_svc.load_session(session_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Dataset not found.")


def _get_dataset_name(workspace_id: str, dataset_id: str) -> str:
    try:
        meta = workspace_svc.load_meta(workspace_id)
        for ds in meta["datasets"]:
            if ds["dataset_id"] == dataset_id:
                return ds["name"].rsplit(".", 1)[0]
    except Exception:
        pass
    return dataset_id[:8]


@router.get("/transform/ai-available")
async def check_ai():
    return {"available": claude_client.ai_available()}


@router.post("/transform/suggest", response_model=SuggestResponse)
async def suggest(body: SuggestRequest):
    df = _load(body.session_id)

    if not claude_client.ai_available():
        return SuggestResponse(
            suggestions=Suggestions(),
            ai_available=False,
            message="AI suggestions are disabled — set ANTHROPIC_API_KEY to enable.",
        )

    try:
        raw = claude_client.suggest_transforms(df, body.user_context)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Claude API error: {exc}") from exc

    return SuggestResponse(suggestions=Suggestions(**raw), ai_available=True)


@router.post("/transform/apply", response_model=ApplyResponse)
async def apply_transforms(body: ApplyRequest):
    df = _load(body.session_id)
    try:
        updated = eda_engine.apply_transforms(df, body.renames, body.type_casts, body.imputations)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    session_svc.save_session(body.session_id, updated)
    return ApplyResponse(success=True)


@router.post("/transform/impute", response_model=ShapeResponse)
async def impute_column(body: ImputeRequest):
    df = _load(body.dataset_id)
    try:
        updated = eda_engine.impute_advanced(
            df, body.column, body.strategy,
            body.constant_value, body.group_by, body.sort_by,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    session_svc.save_session(body.dataset_id, updated)
    rows, cols = len(updated), len(updated.columns)
    if body.workspace_id:
        try:
            workspace_svc.update_dataset_stats(body.workspace_id, body.dataset_id, rows, cols)
        except FileNotFoundError:
            pass
    return ShapeResponse(rows=rows, columns=cols)


@router.post("/transform/drop_columns", response_model=ShapeResponse)
async def drop_columns(body: DropColumnsRequest):
    df = _load(body.dataset_id)
    try:
        updated = eda_engine.drop_columns(df, body.columns)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    session_svc.save_session(body.dataset_id, updated)
    rows, cols = len(updated), len(updated.columns)
    if body.workspace_id:
        try:
            workspace_svc.update_dataset_stats(body.workspace_id, body.dataset_id, rows, cols)
        except FileNotFoundError:
            pass
    return ShapeResponse(rows=rows, columns=cols)


@router.post("/transform/mutate", response_model=ShapeResponse)
async def mutate_column(body: MutateRequest):
    df = _load(body.dataset_id)
    try:
        updated = eda_engine.add_custom_field(df, body.column_name, body.expression)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    session_svc.save_session(body.dataset_id, updated)
    rows, cols = len(updated), len(updated.columns)
    if body.workspace_id:
        try:
            workspace_svc.update_dataset_stats(body.workspace_id, body.dataset_id, rows, cols)
        except FileNotFoundError:
            pass
    return ShapeResponse(rows=rows, columns=cols)


@router.post("/transform/join", response_model=WorkspaceJoinResponse)
async def workspace_join(body: WorkspaceJoinRequest):
    try:
        left = session_svc.load_session(body.left_dataset_id)
        right = session_svc.load_session(body.right_dataset_id)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    try:
        joined = eda_engine.join_datasets(left, right, [body.left_key], [body.right_key], body.join_type)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    left_name = _get_dataset_name(body.workspace_id, body.left_dataset_id)
    right_name = _get_dataset_name(body.workspace_id, body.right_dataset_id)
    join_name = f"{left_name}_x_{right_name}.csv"

    try:
        new_dataset_id = workspace_svc.add_dataset(body.workspace_id, joined, join_name)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    return WorkspaceJoinResponse(
        workspace_id=body.workspace_id,
        new_dataset_id=new_dataset_id,
        rows=len(joined),
        columns=len(joined.columns),
    )
