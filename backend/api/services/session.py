from __future__ import annotations

import os
import time
from pathlib import Path
from uuid import uuid4

import pandas as pd

SESSION_DIR = Path(os.getenv("SESSION_DIR", "/tmp/app_sessions"))
SESSION_TTL_HOURS = 2


def _session_path(session_id: str) -> Path:
    return SESSION_DIR / f"{session_id}.parquet"


def create_session(df: pd.DataFrame) -> str:
    SESSION_DIR.mkdir(parents=True, exist_ok=True)
    session_id = str(uuid4())
    df.to_parquet(_session_path(session_id), index=False)
    return session_id


def load_session(session_id: str) -> pd.DataFrame:
    path = _session_path(session_id)
    if not path.exists():
        raise FileNotFoundError(f"Session not found: {session_id}")
    return pd.read_parquet(path)


def save_session(session_id: str, df: pd.DataFrame) -> None:
    SESSION_DIR.mkdir(parents=True, exist_ok=True)
    df.to_parquet(_session_path(session_id), index=False)


def cleanup_old_sessions() -> int:
    if not SESSION_DIR.exists():
        return 0
    cutoff = time.time() - SESSION_TTL_HOURS * 3600
    removed = 0
    for path in SESSION_DIR.glob("*.parquet"):
        try:
            if path.stat().st_mtime < cutoff:
                path.unlink()
                removed += 1
        except OSError:
            pass
    return removed
