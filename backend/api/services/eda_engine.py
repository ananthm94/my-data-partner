from __future__ import annotations

import ast
import math
import re
from typing import Any

import numpy as np
import pandas as pd
from scipy import stats


# ---------------------------------------------------------------------------
# Type inference
# ---------------------------------------------------------------------------

def infer_type(series: pd.Series) -> str:
    col = str(series.name)
    clean = series.dropna()

    if pd.api.types.is_bool_dtype(series):
        return "boolean"

    if _is_identifier(col, series):
        return "identifier"

    if pd.api.types.is_numeric_dtype(series):
        unique_ratio = clean.nunique() / max(len(clean), 1)
        if clean.nunique() <= 12 and unique_ratio <= 0.08 and len(clean) >= 100:
            return "numeric_category"
        return "numeric"

    if pd.api.types.is_datetime64_any_dtype(series):
        return "datetime"

    if _is_boolean_like(clean):
        return "boolean"

    if _is_datetime_like(clean):
        return "datetime"

    unique_ratio = clean.nunique() / max(len(clean), 1)
    avg_len = clean.astype(str).str.len().mean() if len(clean) else 0
    if unique_ratio > 0.5 and avg_len > 30:
        return "text"

    return "categorical"


def _is_identifier(col: str, series: pd.Series) -> bool:
    clean = series.dropna()
    if len(clean) < 10:
        return False
    name_hint = col.lower() in {"id", "uuid", "guid"} or col.lower().endswith(("_id", " id", "uuid"))
    return bool(name_hint and clean.nunique() / len(clean) >= 0.95)


def _is_boolean_like(clean: pd.Series) -> bool:
    values = {str(v).strip().lower() for v in clean.unique()}
    return bool(values and len(values) <= 2 and values.issubset({"true", "false", "yes", "no", "y", "n", "0", "1"}))


def _is_datetime_like(clean: pd.Series) -> bool:
    sample = clean.astype(str).head(200)
    if len(sample) < 2:
        return False
    pattern = re.compile(r"(\d{4}[-/]\d{1,2}[-/]\d{1,2})|(\d{1,2}[-/]\d{1,2}[-/]\d{2,4})|(T\d{2}:)")
    if sample.map(lambda v: bool(pattern.search(v))).mean() < 0.6:
        return False
    return bool(pd.to_datetime(sample, errors="coerce").notna().mean() >= 0.8)


def _infer_all(df: pd.DataFrame) -> dict[str, str]:
    return {str(col): infer_type(df[col]) for col in df.columns}


# ---------------------------------------------------------------------------
# Metadata & schema
# ---------------------------------------------------------------------------

def get_metadata(df: pd.DataFrame, file_size_bytes: int = 0) -> dict[str, Any]:
    return {
        "total_rows": int(len(df)),
        "total_columns": int(df.shape[1]),
        "file_size_mb": round(file_size_bytes / (1024 * 1024), 2),
    }


def get_schema(df: pd.DataFrame) -> list[dict[str, Any]]:
    types = _infer_all(df)
    result = []
    for col in df.columns:
        col_str = str(col)
        completeness = round((df[col].notna().sum() / max(len(df), 1)) * 100, 1)
        result.append({
            "column_name": col_str,
            "inferred_type": types[col_str],
            "completeness_pct": completeness,
        })
    return result


# ---------------------------------------------------------------------------
# Global profile
# ---------------------------------------------------------------------------

def get_global_profile(df: pd.DataFrame) -> dict[str, Any]:
    numeric_cols = [str(c) for c in df.columns if pd.api.types.is_numeric_dtype(df[c])]
    corr_matrix: dict[str, dict[str, Any]] = {}
    if len(numeric_cols) >= 2:
        corr = df[numeric_cols].apply(pd.to_numeric, errors="coerce").corr().round(3)
        for row_col in corr.index:
            corr_matrix[str(row_col)] = {str(c): _jv(v) for c, v in corr.loc[row_col].items()}

    return {
        "duplicate_rows": int(df.duplicated().sum()),
        "correlation_matrix": corr_matrix,
    }


# ---------------------------------------------------------------------------
# Column profile
# ---------------------------------------------------------------------------

def get_column_profile(df: pd.DataFrame, column: str) -> dict[str, Any]:
    if column not in df.columns:
        raise ValueError(f"Column not found: {column}")
    series = df[column]
    col_type = infer_type(series)

    base: dict[str, Any] = {
        "column_name": column,
        "data_type": col_type,
        "total": int(len(series)),
        "missing": int(series.isna().sum()),
        "missing_pct": round(series.isna().mean() * 100, 2),
        "unique": int(series.nunique(dropna=True)),
    }

    if col_type in ("numeric", "numeric_category"):
        numeric = pd.to_numeric(series, errors="coerce").dropna()
        bins = min(40, max(5, int(len(numeric) ** 0.5)))
        counts, edges = np.histogram(numeric, bins=bins)
        base["stats"] = {
            "min": _jv(numeric.min()),
            "max": _jv(numeric.max()),
            "mean": _jv(round(float(numeric.mean()), 4)),
            "std": _jv(round(float(numeric.std()), 4)),
            "skew": _jv(round(float(numeric.skew()), 4)),
            "kurtosis": _jv(round(float(numeric.kurt()), 4)),
            "q1": _jv(round(float(numeric.quantile(0.25)), 4)),
            "median": _jv(round(float(numeric.median()), 4)),
            "q3": _jv(round(float(numeric.quantile(0.75)), 4)),
        }
        base["distribution_data"] = [
            {"bin_start": _jv(float(edges[i])), "bin_end": _jv(float(edges[i + 1])), "count": int(counts[i])}
            for i in range(len(counts))
        ]

    elif col_type == "datetime":
        dt = pd.to_datetime(series, errors="coerce").dropna()
        freq = _datetime_frequency(dt)
        base["stats"] = {
            "min": dt.min().isoformat() if not dt.empty else None,
            "max": dt.max().isoformat() if not dt.empty else None,
            "span_days": _jv((dt.max() - dt.min()).days) if not dt.empty else None,
        }
        base["frequency_data"] = freq

    elif col_type in ("categorical", "boolean"):
        counts = series.dropna().astype(str).value_counts()
        total = int(series.notna().sum())
        top10 = counts.head(10)
        other_count = int(counts.iloc[10:].sum()) if len(counts) > 10 else 0
        bars = [{"value": str(k), "count": int(v), "pct": round(v / total * 100, 1)} for k, v in top10.items()]
        if other_count:
            bars.append({"value": "Other", "count": other_count, "pct": round(other_count / total * 100, 1)})
        base["distribution_data"] = bars

    elif col_type == "text":
        text = series.dropna().astype(str)
        words: dict[str, int] = {}
        for row_val in text.head(500):
            for w in re.findall(r"\b[a-zA-Z]{3,}\b", row_val.lower()):
                words[w] = words.get(w, 0) + 1
        top_words = sorted(words.items(), key=lambda x: x[1], reverse=True)[:50]
        base["stats"] = {
            "avg_length": _jv(round(text.str.len().mean(), 1)),
            "max_length": int(text.str.len().max()) if len(text) else 0,
        }
        base["word_frequency"] = [{"word": w, "count": c} for w, c in top_words]

    return base


def _datetime_frequency(dt: pd.Series) -> list[dict[str, Any]]:
    if dt.empty:
        return []
    grain = _infer_grain(dt)
    if grain == "month":
        bucketed = dt.dt.to_period("M").astype(str)
    elif grain == "week":
        bucketed = dt.dt.to_period("W").astype(str)
    elif grain == "year":
        bucketed = dt.dt.to_period("Y").astype(str)
    else:
        bucketed = dt.dt.floor("D").astype(str)
    counts = bucketed.value_counts().sort_index().head(200)
    return [{"bucket": str(k), "count": int(v)} for k, v in counts.items()]


def _infer_grain(dt: pd.Series) -> str:
    diffs = dt.sort_values().drop_duplicates().diff().dropna().dt.total_seconds()
    if diffs.empty:
        return "day"
    med = diffs.median()
    if med <= 86_400:
        return "day"
    if med <= 604_800:
        return "week"
    if med <= 2_678_400:
        return "month"
    return "year"


# ---------------------------------------------------------------------------
# Relationship analysis
# ---------------------------------------------------------------------------

def get_relationship(df: pd.DataFrame, x_col: str, y_col: str) -> dict[str, Any]:
    for c in (x_col, y_col):
        if c not in df.columns:
            raise ValueError(f"Column not found: {c}")

    x = pd.to_numeric(df[x_col], errors="coerce")
    y = pd.to_numeric(df[y_col], errors="coerce")
    mask = x.notna() & y.notna()
    x_clean, y_clean = x[mask], y[mask]

    if len(x_clean) < 3:
        raise ValueError("Not enough numeric data to compute relationship.")

    pearson_r, pearson_p = stats.pearsonr(x_clean, y_clean)
    spearman_r, _ = stats.spearmanr(x_clean, y_clean)
    slope, intercept, r_value, p_value, _ = stats.linregress(x_clean, y_clean)

    sample_size = min(500, len(x_clean))
    idx = np.random.choice(len(x_clean), size=sample_size, replace=False)
    scatter_data = [
        {"x": _jv(float(x_clean.iloc[i])), "y": _jv(float(y_clean.iloc[i]))}
        for i in idx
    ]

    return {
        "correlation": {
            "pearson": round(float(pearson_r), 4),
            "spearman": round(float(spearman_r), 4),
        },
        "regression": {
            "slope": round(float(slope), 4),
            "intercept": round(float(intercept), 4),
            "r_squared": round(float(r_value ** 2), 4),
            "p_value": round(float(p_value), 6),
        },
        "scatter_data": scatter_data,
    }


# ---------------------------------------------------------------------------
# Data preview
# ---------------------------------------------------------------------------

def get_head_tail_sample(df: pd.DataFrame) -> dict[str, Any]:
    sample_n = min(10, len(df))
    return {
        "head": _records(df.head(10)),
        "tail": _records(df.tail(10)),
        "sample": _records(df.sample(n=sample_n, random_state=42)),
        "columns": [str(c) for c in df.columns],
    }


# ---------------------------------------------------------------------------
# Transforms: apply renames / type casts / imputations
# ---------------------------------------------------------------------------

def apply_transforms(
    df: pd.DataFrame,
    renames: dict[str, str] | None,
    type_casts: dict[str, str] | None,
    imputations: dict[str, str] | None,
) -> pd.DataFrame:
    df = df.copy()

    if renames:
        df = df.rename(columns=renames)

    if type_casts:
        for col, target_type in type_casts.items():
            if col not in df.columns:
                continue
            try:
                if target_type == "datetime64[ns]":
                    df[col] = pd.to_datetime(df[col], errors="coerce")
                elif target_type == "category":
                    df[col] = df[col].astype("category")
                elif target_type == "boolean":
                    df[col] = df[col].map(lambda v: True if str(v).lower() in {"true", "yes", "1", "y"} else (False if str(v).lower() in {"false", "no", "0", "n"} else None))
                else:
                    df[col] = pd.to_numeric(df[col], errors="coerce").astype(target_type)
            except Exception:
                pass

    if imputations:
        for col, strategy in imputations.items():
            if col not in df.columns:
                continue
            try:
                if strategy == "drop":
                    df = df.dropna(subset=[col])
                elif strategy == "mean":
                    df[col] = df[col].fillna(pd.to_numeric(df[col], errors="coerce").mean())
                elif strategy == "median":
                    df[col] = df[col].fillna(pd.to_numeric(df[col], errors="coerce").median())
                elif strategy == "mode":
                    mode = df[col].mode(dropna=True)
                    if not mode.empty:
                        df[col] = df[col].fillna(mode.iloc[0])
            except Exception:
                pass

    return df.reset_index(drop=True)


# ---------------------------------------------------------------------------
# Cleaning actions
# ---------------------------------------------------------------------------

CLEAN_ACTIONS = (
    "drop_duplicates", "drop_missing_rows", "drop_column",
    "impute_mean", "impute_median", "impute_mode", "ffill", "bfill",
    "remove_iqr_outliers", "log_transform", "sqrt_transform",
)


def apply_cleaning(df: pd.DataFrame, action: str, column: str | None = None) -> pd.DataFrame:
    result = df.copy()

    if action == "drop_duplicates":
        return result.drop_duplicates().reset_index(drop=True)

    if action == "drop_missing_rows":
        return result.dropna(subset=[column] if column else None).reset_index(drop=True)

    if action == "drop_column":
        if not column or column not in result.columns:
            raise ValueError("Valid column required.")
        return result.drop(columns=[column])

    if column not in result.columns:
        raise ValueError(f"Column '{column}' not found.")

    if action == "impute_mean":
        result[column] = result[column].fillna(pd.to_numeric(result[column], errors="coerce").mean())
    elif action == "impute_median":
        result[column] = result[column].fillna(pd.to_numeric(result[column], errors="coerce").median())
    elif action == "impute_mode":
        mode = result[column].mode(dropna=True)
        if not mode.empty:
            result[column] = result[column].fillna(mode.iloc[0])
    elif action == "ffill":
        result[column] = result[column].ffill()
    elif action == "bfill":
        result[column] = result[column].bfill()
    elif action == "remove_iqr_outliers":
        numeric = pd.to_numeric(result[column], errors="coerce")
        q1, q3 = numeric.quantile(0.25), numeric.quantile(0.75)
        iqr = q3 - q1
        result = result[(numeric >= q1 - 1.5 * iqr) & (numeric <= q3 + 1.5 * iqr)].reset_index(drop=True)
    elif action == "log_transform":
        numeric = pd.to_numeric(result[column], errors="coerce")
        result[f"{column}_log"] = np.log(numeric.where(numeric > 0))
    elif action == "sqrt_transform":
        numeric = pd.to_numeric(result[column], errors="coerce")
        result[f"{column}_sqrt"] = np.sqrt(numeric.where(numeric >= 0))
    else:
        raise ValueError(f"Unknown action: {action}")

    return result


# ---------------------------------------------------------------------------
# Custom field
# ---------------------------------------------------------------------------

_SAFE_NAMES = {"pd", "np", "abs", "round", "min", "max", "col"}
_BLOCKED_NAMES = {"open", "exec", "eval", "__import__", "compile", "input", "globals", "locals", "os", "sys", "subprocess"}
_BLOCKED_ATTRS = {"to_pickle", "to_csv", "to_parquet", "read_csv", "read_pickle", "read_parquet", "read_sql", "eval", "query"}


def add_custom_field(df: pd.DataFrame, column_name: str, expression: str) -> pd.DataFrame:
    column_name = (column_name or "").strip()
    if not column_name:
        raise ValueError("Column name is required.")
    if column_name in df.columns:
        raise ValueError("Column already exists.")
    expression = (expression or "").strip()
    if not expression:
        raise ValueError("Expression is required.")

    tree = ast.parse(expression, mode="eval")
    _validate_ast(tree, set(str(c) for c in df.columns))

    scope = {
        "pd": pd, "np": np, "abs": abs, "round": round, "min": min, "max": max,
        "col": lambda name: df[name],
    }
    scope.update({str(c): df[c] for c in df.columns if str(c).isidentifier()})
    result_val = eval(compile(tree, "<expr>", "eval"), {"__builtins__": {}}, scope)

    out = df.copy()
    if isinstance(result_val, pd.Series):
        out[column_name] = result_val.values
    elif np.isscalar(result_val):
        out[column_name] = result_val
    else:
        out[column_name] = list(result_val)
    return out


def _validate_ast(tree: ast.AST, columns: set[str]) -> None:
    blocked_nodes = (ast.Import, ast.ImportFrom, ast.Assign, ast.AugAssign, ast.Delete, ast.Lambda, ast.FunctionDef, ast.ClassDef)
    for node in ast.walk(tree):
        if isinstance(node, blocked_nodes):
            raise ValueError("Only a single safe expression is allowed.")
        if isinstance(node, ast.Name):
            if node.id in _BLOCKED_NAMES:
                raise ValueError(f"Unsafe name: {node.id}")
            if node.id not in _SAFE_NAMES and node.id not in columns:
                raise ValueError(f"Unknown name: {node.id}")
        if isinstance(node, ast.Attribute):
            if node.attr.startswith("_") or node.attr in _BLOCKED_ATTRS:
                raise ValueError(f"Unsafe attribute: {node.attr}")


# ---------------------------------------------------------------------------
# Join
# ---------------------------------------------------------------------------

def join_datasets(
    left: pd.DataFrame,
    right: pd.DataFrame,
    left_keys: list[str],
    right_keys: list[str],
    how: str = "inner",
) -> pd.DataFrame:
    if how not in ("inner", "left", "right", "outer"):
        raise ValueError("how must be inner/left/right/outer")
    if not left_keys or not right_keys or len(left_keys) != len(right_keys):
        raise ValueError("Provide matching left and right key lists.")
    for k in left_keys:
        if k not in left.columns:
            raise ValueError(f"Left key not found: {k}")
    for k in right_keys:
        if k not in right.columns:
            raise ValueError(f"Right key not found: {k}")
    return left.merge(right, how=how, left_on=left_keys, right_on=right_keys, suffixes=("_left", "_right"))


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _records(df: pd.DataFrame) -> list[dict[str, Any]]:
    return [{str(k): _jv(v) for k, v in row.items()} for row in df.to_dict("records")]


def _jv(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, (np.integer,)):
        return int(value)
    if isinstance(value, (np.floating,)):
        f = float(value)
        return None if (math.isnan(f) or math.isinf(f)) else f
    if isinstance(value, (np.bool_,)):
        return bool(value)
    if isinstance(value, pd.Timestamp):
        return value.isoformat()
    if isinstance(value, float) and (math.isnan(value) or math.isinf(value)):
        return None
    try:
        if pd.isna(value) and not isinstance(value, (list, dict, tuple)):
            return None
    except (TypeError, ValueError):
        pass
    return value
