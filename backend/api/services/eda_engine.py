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
        unique_vals = numeric.unique()
        is_discrete = (
            len(unique_vals) <= 50
            and len(numeric) > 0
            and bool(np.all(np.abs(numeric - np.round(numeric)) < 1e-9))
        )
        if is_discrete:
            vc = numeric.round().astype(int).value_counts().sort_index()
            base["distribution_data"] = [
                {"bin_start": int(k), "bin_end": int(k), "count": int(v)}
                for k, v in vc.items()
            ]
        else:
            bins = min(40, max(5, int(len(numeric) ** 0.5)))
            counts, edges = np.histogram(numeric, bins=bins)
            base["distribution_data"] = [
                {"bin_start": _jv(float(edges[i])), "bin_end": _jv(float(edges[i + 1])), "count": int(counts[i])}
                for i in range(len(counts))
            ]
        base["is_discrete"] = is_discrete
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
        base["outlier_stats"] = _compute_outlier_stats(numeric)

    elif col_type == "datetime":
        dt = pd.to_datetime(series, errors="coerce").dropna()
        base["stats"] = {
            "min": dt.min().isoformat() if not dt.empty else None,
            "max": dt.max().isoformat() if not dt.empty else None,
            "span_days": _jv((dt.max() - dt.min()).days) if not dt.empty else None,
        }
        base["frequency_data"] = _datetime_frequency(dt, "day")
        base["frequency_data_weekly"] = _datetime_frequency(dt, "week")
        base["frequency_data_monthly"] = _datetime_frequency(dt, "month")
        base["outlier_stats"] = _compute_date_outlier_stats(dt)

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


def _datetime_frequency(dt: pd.Series, grain: str = "day") -> list[dict[str, Any]]:
    if dt.empty:
        return []
    period_map = {"day": "D", "week": "W", "month": "M"}
    period_freq = period_map.get(grain, "D")
    bucketed = dt.dt.to_period(period_freq)
    counts = bucketed.value_counts().sort_index()
    return [{"bucket": str(k), "count": int(v)} for k, v in counts.items()]


def _compute_outlier_stats(series: pd.Series) -> dict[str, Any]:
    clean = series.dropna()
    if len(clean) < 4:
        return {}
    q1 = float(clean.quantile(0.25))
    q3 = float(clean.quantile(0.75))
    iqr = q3 - q1
    iqr_lower = q1 - 1.5 * iqr
    iqr_upper = q3 + 1.5 * iqr
    outlier_mask = (clean < iqr_lower) | (clean > iqr_upper)
    iqr_outlier_count = int(outlier_mask.sum())
    outlier_values = [_jv(float(v)) for v in clean[outlier_mask].head(50).tolist()]
    mean_val = float(clean.mean())
    std_val = float(clean.std(ddof=0))
    zscore_outlier_count = 0
    if std_val > 0:
        z_scores = (clean - mean_val) / std_val
        zscore_outlier_count = int((z_scores.abs() > 3.0).sum())
    negative_count = int((clean < 0).sum())
    return {
        "iqr_lower": round(iqr_lower, 4),
        "iqr_upper": round(iqr_upper, 4),
        "iqr_outlier_count": iqr_outlier_count,
        "zscore_outlier_count": zscore_outlier_count,
        "zscore_threshold": 3.0,
        "negative_count": negative_count,
        "outlier_values": outlier_values,
    }


def _compute_date_outlier_stats(dt: pd.Series) -> dict[str, Any]:
    if len(dt) < 4:
        return {}
    try:
        dt_utc = dt.dt.tz_convert(None) if (hasattr(dt.dt, "tz") and dt.dt.tz is not None) else dt
        ts = dt_utc.astype("int64")  # nanoseconds since epoch
    except (TypeError, ValueError, AttributeError):
        return {}
    q1_ts = float(ts.quantile(0.25))
    q3_ts = float(ts.quantile(0.75))
    iqr_ts = q3_ts - q1_ts
    if iqr_ts == 0:
        return {"iqr_outlier_count": 0, "iqr_lower_date": None, "iqr_upper_date": None}
    lower = q1_ts - 1.5 * iqr_ts
    upper = q3_ts + 1.5 * iqr_ts
    outlier_count = int(((ts < lower) | (ts > upper)).sum())
    try:
        lower_dt = pd.Timestamp(int(lower)).isoformat()
        upper_dt = pd.Timestamp(int(upper)).isoformat()
    except (OverflowError, ValueError, OSError):
        lower_dt, upper_dt = None, None
    return {
        "iqr_outlier_count": outlier_count,
        "iqr_lower_date": lower_dt,
        "iqr_upper_date": upper_dt,
    }


# ---------------------------------------------------------------------------
# Relationship analysis
# ---------------------------------------------------------------------------

def get_relationship(df: pd.DataFrame, x_col: str, y_col: str) -> dict[str, Any]:
    for c in (x_col, y_col):
        if c not in df.columns:
            raise ValueError(f"Column not found: {c}")

    x_type = infer_type(df[x_col])
    y_type = infer_type(df[y_col])
    x_is_num = x_type in ("numeric", "numeric_category")
    y_is_num = y_type in ("numeric", "numeric_category")

    if x_is_num and y_is_num:
        return _rel_cont_cont(df, x_col, y_col)
    elif not x_is_num and y_is_num:
        return _rel_cat_cont(df, x_col, y_col)
    elif x_is_num and not y_is_num:
        return _rel_cat_cont(df, y_col, x_col)
    else:
        return _rel_cat_cat(df, x_col, y_col)


def _rel_cont_cont(df: pd.DataFrame, x_col: str, y_col: str) -> dict[str, Any]:
    x = pd.to_numeric(df[x_col], errors="coerce")
    y = pd.to_numeric(df[y_col], errors="coerce")
    mask = x.notna() & y.notna()
    x_clean, y_clean = x[mask], y[mask]

    if len(x_clean) < 3:
        raise ValueError("Not enough numeric data to compute relationship.")

    pearson_r, _ = stats.pearsonr(x_clean, y_clean)
    spearman_r, _ = stats.spearmanr(x_clean, y_clean)
    slope, intercept, r_value, p_value, _ = stats.linregress(x_clean, y_clean)

    sample_size = min(500, len(x_clean))
    idx = np.random.choice(len(x_clean), size=sample_size, replace=False)
    scatter_data = [
        {"x": _jv(float(x_clean.iloc[i])), "y": _jv(float(y_clean.iloc[i]))}
        for i in idx
    ]

    return {
        "analysis_type": "cont_cont",
        "correlation": {"pearson": round(float(pearson_r), 4), "spearman": round(float(spearman_r), 4)},
        "regression": {"slope": round(float(slope), 4), "intercept": round(float(intercept), 4), "r_squared": round(float(r_value ** 2), 4), "p_value": round(float(p_value), 6)},
        "scatter_data": scatter_data,
        "box_data": None,
        "crosstab_data": None,
        "crosstab_columns": None,
    }


def _rel_cat_cont(df: pd.DataFrame, cat_col: str, num_col: str) -> dict[str, Any]:
    num = pd.to_numeric(df[num_col], errors="coerce")
    mask = df[cat_col].notna() & num.notna()
    cat_series = df[cat_col].astype(str)
    top_cats = cat_series[mask].value_counts().head(10).index.tolist()

    box_data = []
    for cat_val in top_cats:
        cat_mask = mask & (cat_series == cat_val)
        values = num[cat_mask].dropna()
        if len(values) < 3:
            continue
        q1 = float(values.quantile(0.25))
        q3 = float(values.quantile(0.75))
        iqr = q3 - q1
        w_low = float(values[values >= q1 - 1.5 * iqr].min())
        w_high = float(values[values <= q3 + 1.5 * iqr].max())
        outliers = [_jv(float(v)) for v in values[(values < w_low) | (values > w_high)].head(30).tolist()]
        box_data.append({
            "category": cat_val,
            "q1": round(q1, 4),
            "median": round(float(values.median()), 4),
            "q3": round(q3, 4),
            "whisker_low": round(w_low, 4),
            "whisker_high": round(w_high, 4),
            "outliers": outliers,
        })

    return {
        "analysis_type": "cat_cont",
        "correlation": None,
        "regression": None,
        "scatter_data": None,
        "box_data": box_data,
        "crosstab_data": None,
        "crosstab_columns": None,
    }


def _rel_cat_cat(df: pd.DataFrame, x_col: str, y_col: str) -> dict[str, Any]:
    mask = df[x_col].notna() & df[y_col].notna()
    x_series = df[x_col].astype(str)
    y_series = df[y_col].astype(str)
    top_x = x_series[mask].value_counts().head(8).index.tolist()
    top_y = y_series[mask].value_counts().head(8).index.tolist()

    sub_mask = mask & x_series.isin(top_x) & y_series.isin(top_y)
    if not sub_mask.any():
        raise ValueError("No overlapping data for categorical analysis.")

    ct = pd.crosstab(x_series[sub_mask], y_series[sub_mask])
    crosstab_data = {str(idx): {str(c): int(v) for c, v in row.items()} for idx, row in ct.iterrows()}

    return {
        "analysis_type": "cat_cat",
        "correlation": None,
        "regression": None,
        "scatter_data": None,
        "box_data": None,
        "crosstab_data": crosstab_data,
        "crosstab_columns": [str(c) for c in ct.columns],
    }


# ---------------------------------------------------------------------------
# Data preview
# ---------------------------------------------------------------------------

def get_head_tail_sample(df: pd.DataFrame, randomize: bool = False) -> dict[str, Any]:
    import random as _random
    sample_n = min(10, len(df))
    random_state = _random.randint(0, 99999) if randomize else 42
    return {
        "head": _records(df.head(10)),
        "tail": _records(df.tail(10)),
        "sample": _records(df.sample(n=sample_n, random_state=random_state)),
        "columns": [str(c) for c in df.columns],
    }


def get_dataframe_info(df: pd.DataFrame) -> dict[str, Any]:
    null_counts = df.isnull().sum()
    info = [
        {
            "column": str(col),
            "dtype": str(df[col].dtype),
            "non_null_count": int(df[col].notna().sum()),
            "null_count": int(null_counts[col]),
        }
        for col in df.columns
    ]
    numeric_cols = df.select_dtypes(include=[np.number]).columns.tolist()
    describe: dict[str, dict[str, Any]] = {}
    if numeric_cols:
        desc = df[numeric_cols].describe().round(4)
        for col in desc.columns:
            describe[str(col)] = {str(k): _jv(v) for k, v in desc[col].items()}
    return {"info": info, "describe": describe}


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
    "remove_iqr_outliers", "remove_zscore_outliers", "remove_negative_outliers",
    "remove_date_outliers", "log_transform", "sqrt_transform",
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
    elif action == "remove_zscore_outliers":
        numeric = pd.to_numeric(result[column], errors="coerce")
        mean_val = float(numeric.mean())
        std_val = float(numeric.std(ddof=0))
        if std_val > 0:
            z_scores = (numeric - mean_val) / std_val
            result = result[(z_scores.abs() <= 3.0) | numeric.isna()].reset_index(drop=True)
    elif action == "remove_negative_outliers":
        numeric = pd.to_numeric(result[column], errors="coerce")
        result = result[(numeric >= 0) | numeric.isna()].reset_index(drop=True)
    elif action == "remove_date_outliers":
        dt = pd.to_datetime(result[column], errors="coerce")
        try:
            dt_utc = dt.dt.tz_convert(None) if (hasattr(dt.dt, "tz") and dt.dt.tz is not None) else dt
            ts = dt_utc.astype("int64")
        except (TypeError, ValueError, AttributeError):
            pass
        else:
            valid_mask = dt.notna()
            valid_ts = ts[valid_mask]
            if len(valid_ts) >= 4:
                q1_ts = float(valid_ts.quantile(0.25))
                q3_ts = float(valid_ts.quantile(0.75))
                iqr_ts = q3_ts - q1_ts
                if iqr_ts > 0:
                    lower = q1_ts - 1.5 * iqr_ts
                    upper = q3_ts + 1.5 * iqr_ts
                    keep = (~valid_mask) | ((ts >= lower) & (ts <= upper))
                    result = result[keep].reset_index(drop=True)
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
# Advanced imputation
# ---------------------------------------------------------------------------

VALID_IMPUTE_STRATEGIES = {"mean", "median", "mode", "constant", "ffill", "bfill"}


def impute_advanced(
    df: pd.DataFrame,
    column: str,
    strategy: str,
    constant_value: str | None = None,
    group_by: str | None = None,
    sort_by: str | None = None,
) -> pd.DataFrame:
    if column not in df.columns:
        raise ValueError(f"Column not found: {column}")
    if strategy not in VALID_IMPUTE_STRATEGIES:
        raise ValueError(f"Unknown strategy: {strategy}. Must be one of {sorted(VALID_IMPUTE_STRATEGIES)}")

    result = df.copy()

    if strategy in ("ffill", "bfill") and sort_by:
        if sort_by not in result.columns:
            raise ValueError(f"Sort column not found: {sort_by}")
        result = result.sort_values(sort_by).reset_index(drop=True)

    if group_by and group_by in result.columns:
        if strategy == "mean":
            result[column] = result.groupby(group_by)[column].transform(
                lambda x: x.fillna(pd.to_numeric(x, errors="coerce").mean())
            )
        elif strategy == "median":
            result[column] = result.groupby(group_by)[column].transform(
                lambda x: x.fillna(pd.to_numeric(x, errors="coerce").median())
            )
        elif strategy == "mode":
            result[column] = result.groupby(group_by)[column].transform(
                lambda x: x.fillna(x.mode().iloc[0] if len(x.mode()) > 0 else x)
            )
        elif strategy == "ffill":
            result[column] = result.groupby(group_by)[column].transform(lambda x: x.ffill())
        elif strategy == "bfill":
            result[column] = result.groupby(group_by)[column].transform(lambda x: x.bfill())
        elif strategy == "constant":
            result[column] = result[column].fillna(constant_value)
    else:
        if strategy == "mean":
            result[column] = result[column].fillna(pd.to_numeric(result[column], errors="coerce").mean())
        elif strategy == "median":
            result[column] = result[column].fillna(pd.to_numeric(result[column], errors="coerce").median())
        elif strategy == "mode":
            mode = result[column].mode(dropna=True)
            if not mode.empty:
                result[column] = result[column].fillna(mode.iloc[0])
        elif strategy == "constant":
            result[column] = result[column].fillna(constant_value)
        elif strategy == "ffill":
            result[column] = result[column].ffill()
        elif strategy == "bfill":
            result[column] = result[column].bfill()

    return result


def drop_columns(df: pd.DataFrame, columns: list[str]) -> pd.DataFrame:
    missing = [c for c in columns if c not in df.columns]
    if missing:
        raise ValueError(f"Columns not found: {missing}")
    return df.drop(columns=columns)


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
