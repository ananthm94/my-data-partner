from __future__ import annotations

from fastapi import APIRouter, HTTPException

from api.models.schemas import ApplyRequest, ApplyResponse, SuggestRequest, SuggestResponse, Suggestions
from api.services import claude_client, eda_engine, session as session_svc

router = APIRouter()


def _load(session_id: str):
    try:
        return session_svc.load_session(session_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Session not found.")


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
