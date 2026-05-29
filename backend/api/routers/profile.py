from __future__ import annotations

from fastapi import APIRouter, HTTPException

from api.models.schemas import ColumnProfileResponse, DataframeInfoResponse, GlobalProfileResponse
from api.services import eda_engine, session as session_svc

router = APIRouter()


def _load(session_id: str):
    try:
        return session_svc.load_session(session_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Session not found.")


@router.get("/profile/global", response_model=GlobalProfileResponse)
async def global_profile(session_id: str):
    df = _load(session_id)
    result = eda_engine.get_global_profile(df)
    return GlobalProfileResponse(**result)


@router.get("/profile/column", response_model=ColumnProfileResponse)
async def column_profile(session_id: str, column_name: str):
    df = _load(session_id)
    try:
        result = eda_engine.get_column_profile(df, column_name)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return ColumnProfileResponse(**result)


@router.get("/profile/dataframe-info", response_model=DataframeInfoResponse)
async def dataframe_info(session_id: str):
    df = _load(session_id)
    result = eda_engine.get_dataframe_info(df)
    return DataframeInfoResponse(**result)
