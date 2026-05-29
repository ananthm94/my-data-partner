from __future__ import annotations

from fastapi import APIRouter, HTTPException

from api.models.schemas import CleanRequest, CleanResponse
from api.services import eda_engine, session as session_svc

router = APIRouter()


def _load(session_id: str):
    try:
        return session_svc.load_session(session_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Session not found.")


@router.post("/clean", response_model=CleanResponse)
async def clean(body: CleanRequest):
    df = _load(body.session_id)
    rows_before = len(df)
    cols_before = len(df.columns)

    try:
        cleaned = eda_engine.apply_cleaning(df, body.action, body.column)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    session_svc.save_session(body.session_id, cleaned)

    return CleanResponse(
        session_id=body.session_id,
        rows_before=rows_before,
        rows_after=len(cleaned),
        columns_before=cols_before,
        columns_after=len(cleaned.columns),
    )
