from __future__ import annotations

import io

import pandas as pd
from fastapi import APIRouter, File, HTTPException, UploadFile

from api.models.schemas import ColumnSchema, Metadata, UploadResponse
from api.services import eda_engine, workspace as workspace_svc

router = APIRouter()

MAX_UPLOAD_BYTES = 100 * 1024 * 1024  # 100 MB


@router.post("/upload", response_model=UploadResponse)
async def upload_file(file: UploadFile = File(...)):
    if not file.filename or not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="Only CSV files are accepted.")

    raw = await file.read()
    if len(raw) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="File exceeds the 100 MB limit.")

    try:
        df = pd.read_csv(io.BytesIO(raw), on_bad_lines="skip")
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Could not parse CSV: {exc}") from exc

    workspace_id, dataset_id = workspace_svc.create_workspace(df, file.filename or "dataset.csv")
    metadata = eda_engine.get_metadata(df, file_size_bytes=len(raw))
    schema = eda_engine.get_schema(df)

    return UploadResponse(
        session_id=dataset_id,
        workspace_id=workspace_id,
        dataset_id=dataset_id,
        metadata=Metadata(**metadata),
        schema_=[ColumnSchema(**col) for col in schema],
    )
