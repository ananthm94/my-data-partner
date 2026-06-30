from __future__ import annotations

import os
import re
from pathlib import Path

import duckdb

DATA_DIR = Path(os.getenv("DATA_DIR", Path(__file__).parent.parent.parent / "data"))

_db_path = DATA_DIR / "warehouse.duckdb"
_conn: duckdb.DuckDBPyConnection | None = None


def _ensure_dir() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)


def _sanitize_table_name(filename: str) -> str:
    name = Path(filename).stem
    name = re.sub(r"[^a-zA-Z0-9_]", "_", name)
    name = re.sub(r"_+", "_", name).strip("_").lower()
    if not name or name[0].isdigit():
        name = f"t_{name}"
    return name


def get_connection() -> duckdb.DuckDBPyConnection:
    global _conn
    if _conn is None:
        _ensure_dir()
        _conn = duckdb.connect(str(_db_path))
    return _conn


def load_csv_to_table(file_path: str, filename: str) -> dict:
    conn = get_connection()
    table_name = _sanitize_table_name(filename)
    conn.execute(f"DROP TABLE IF EXISTS {table_name}")
    conn.execute(
        f"CREATE TABLE {table_name} AS SELECT * FROM read_csv_auto('{file_path}')"
    )
    row_count = conn.execute(f"SELECT COUNT(*) FROM {table_name}").fetchone()[0]
    cols = conn.execute(
        f"SELECT column_name, data_type FROM information_schema.columns "
        f"WHERE table_name = '{table_name}' ORDER BY ordinal_position"
    ).fetchall()
    return {
        "name": table_name,
        "row_count": row_count,
        "columns": [{"name": c[0], "type": c[1]} for c in cols],
    }


def list_tables() -> list[dict]:
    conn = get_connection()
    tables = conn.execute(
        "SELECT table_name FROM information_schema.tables "
        "WHERE table_schema = 'main' AND table_type = 'BASE TABLE'"
    ).fetchall()
    result = []
    for (tname,) in tables:
        row_count = conn.execute(f"SELECT COUNT(*) FROM {tname}").fetchone()[0]
        cols = conn.execute(
            f"SELECT column_name, data_type FROM information_schema.columns "
            f"WHERE table_name = '{tname}' ORDER BY ordinal_position"
        ).fetchall()
        result.append({
            "name": tname,
            "row_count": row_count,
            "columns": [{"name": c[0], "type": c[1]} for c in cols],
        })
    return result


def run_query(sql: str) -> list[dict]:
    conn = get_connection()
    rel = conn.execute(sql)
    columns = [desc[0] for desc in rel.description]
    rows = rel.fetchall()
    return [dict(zip(columns, row)) for row in rows]


def get_sample_rows(table_name: str, n: int = 5) -> list[dict]:
    return run_query(f"SELECT * FROM {table_name} LIMIT {n}")


def reset() -> None:
    global _conn
    if _conn is not None:
        _conn.close()
        _conn = None
    if _db_path.exists():
        _db_path.unlink()
