from __future__ import annotations

import io

import pandas as pd
from fastapi import APIRouter, File, HTTPException, UploadFile

from api.models.schemas import AddDatasetResponse, WorkspaceDataset, WorkspaceMeta
from api.services import workspace as workspace_svc

router = APIRouter()

MAX_UPLOAD_BYTES = 100 * 1024 * 1024


@router.get("/workspace/{workspace_id}", response_model=WorkspaceMeta)
async def get_workspace(workspace_id: str):
    try:
        meta = workspace_svc.load_meta(workspace_id)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return WorkspaceMeta(
        workspace_id=meta["workspace_id"],
        datasets=[WorkspaceDataset(**ds) for ds in meta["datasets"]],
        active_dataset_id=meta["active_dataset_id"],
    )


@router.post("/workspace/{workspace_id}/upload", response_model=AddDatasetResponse)
async def add_dataset(workspace_id: str, file: UploadFile = File(...)):
    if not file.filename or not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="Only CSV files are accepted.")

    raw = await file.read()
    if len(raw) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="File exceeds the 100 MB limit.")

    try:
        df = pd.read_csv(io.BytesIO(raw), on_bad_lines="skip")
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Could not parse CSV: {exc}") from exc

    try:
        dataset_id = workspace_svc.add_dataset(workspace_id, df, file.filename or "dataset.csv")
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    return AddDatasetResponse(
        workspace_id=workspace_id,
        dataset_id=dataset_id,
        name=file.filename or "dataset.csv",
        rows=len(df),
        columns=len(df.columns),
    )
