from __future__ import annotations

import json
from pathlib import Path
from uuid import uuid4

import pandas as pd

from api.services.session import SESSION_DIR, create_session


def _meta_path(workspace_id: str) -> Path:
    return SESSION_DIR / f"workspace_{workspace_id}.json"


def create_workspace(df: pd.DataFrame, name: str) -> tuple[str, str]:
    """Create workspace with first dataset. Returns (workspace_id, dataset_id)."""
    SESSION_DIR.mkdir(parents=True, exist_ok=True)
    dataset_id = create_session(df)
    workspace_id = str(uuid4())
    _write_meta(workspace_id, {
        "workspace_id": workspace_id,
        "datasets": [{"dataset_id": dataset_id, "name": name, "rows": len(df), "columns": len(df.columns)}],
        "active_dataset_id": dataset_id,
    })
    return workspace_id, dataset_id


def add_dataset(workspace_id: str, df: pd.DataFrame, name: str) -> str:
    """Add dataset to existing workspace. Returns dataset_id."""
    meta = load_meta(workspace_id)
    dataset_id = create_session(df)
    meta["datasets"].append({"dataset_id": dataset_id, "name": name, "rows": len(df), "columns": len(df.columns)})
    meta["active_dataset_id"] = dataset_id
    _write_meta(workspace_id, meta)
    return dataset_id


def load_meta(workspace_id: str) -> dict:
    path = _meta_path(workspace_id)
    if not path.exists():
        raise FileNotFoundError(f"Workspace not found: {workspace_id}")
    with open(path) as f:
        return json.load(f)


def update_dataset_stats(workspace_id: str, dataset_id: str, rows: int, columns: int) -> None:
    meta = load_meta(workspace_id)
    for ds in meta["datasets"]:
        if ds["dataset_id"] == dataset_id:
            ds["rows"] = rows
            ds["columns"] = columns
            break
    _write_meta(workspace_id, meta)


def _write_meta(workspace_id: str, meta: dict) -> None:
    SESSION_DIR.mkdir(parents=True, exist_ok=True)
    with open(_meta_path(workspace_id), "w") as f:
        json.dump(meta, f)
