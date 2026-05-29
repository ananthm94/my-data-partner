from __future__ import annotations

from fastapi import APIRouter, HTTPException

from api.models.schemas import JoinRequest, JoinResponse
from api.services import eda_engine, session as session_svc

router = APIRouter()


@router.post("/join", response_model=JoinResponse)
async def create_join(body: JoinRequest):
    try:
        left = session_svc.load_session(body.left_session_id)
        right = session_svc.load_session(body.right_session_id)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    try:
        joined = eda_engine.join_datasets(left, right, body.left_keys, body.right_keys, body.how)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    new_session_id = session_svc.create_session(joined)
    return JoinResponse(
        session_id=new_session_id,
        total_rows=len(joined),
        total_columns=len(joined.columns),
    )
