from __future__ import annotations

from fastapi import APIRouter, HTTPException

from api.models.schemas import ApplyResponse, CustomFieldPreviewResponse, CustomFieldRequest
from api.services import eda_engine, session as session_svc

router = APIRouter()


def _load(session_id: str):
    try:
        return session_svc.load_session(session_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Session not found.")


@router.post("/custom-field/preview", response_model=CustomFieldPreviewResponse)
async def preview_custom_field(body: CustomFieldRequest):
    df = _load(body.session_id)
    try:
        result = eda_engine.add_custom_field(df, body.column_name, body.expression)
        preview = result[body.column_name].head(5).tolist()
    except Exception as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return CustomFieldPreviewResponse(preview_values=preview)


@router.post("/custom-field/apply", response_model=ApplyResponse)
async def apply_custom_field(body: CustomFieldRequest):
    df = _load(body.session_id)
    try:
        updated = eda_engine.add_custom_field(df, body.column_name, body.expression)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    session_svc.save_session(body.session_id, updated)
    return ApplyResponse(success=True)
