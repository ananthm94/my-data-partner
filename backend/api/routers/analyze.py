from __future__ import annotations

from fastapi import APIRouter, HTTPException

from api.models.schemas import PreviewResponse, RelationshipResponse
from api.services import eda_engine, session as session_svc

router = APIRouter()


def _load(session_id: str):
    try:
        return session_svc.load_session(session_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Session not found.")


@router.get("/analyze/relationship", response_model=RelationshipResponse)
async def relationship(session_id: str, x_column: str, y_column: str):
    df = _load(session_id)
    try:
        result = eda_engine.get_relationship(df, x_column, y_column)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return RelationshipResponse(**result)


@router.get("/data/preview", response_model=PreviewResponse)
async def data_preview(session_id: str):
    df = _load(session_id)
    result = eda_engine.get_head_tail_sample(df)
    return PreviewResponse(**result)
