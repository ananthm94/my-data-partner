from __future__ import annotations

import base64
import ast
import io
import math
import re
from dataclasses import dataclass, field, replace
from pathlib import Path
from typing import Any, Callable

import numpy as np
import pandas as pd


DELIMITERS = {
    "auto": None,
    "comma": ",",
    "tab": "\t",
    "semicolon": ";",
    "pipe": "|",
}

SEMANTIC_TYPES = (
    "numeric",
    "categorical",
    "datetime",
    "boolean",
    "text",
    "ordinal",
    "numeric_category",
    "identifier",
    "ignore",
)
OUTLIER_METHODS = ("iqr", "zscore", "modified_zscore")
JOIN_TYPES = ("inner", "left", "right", "outer")
SAFE_EXPR_NAMES = {"pd", "np", "abs", "round", "min", "max", "col"}


@dataclass(frozen=True)
class EDAConfig:
    delimiter: str = "auto"
    encoding: str = "utf-8"
    header_row: int = 0
    analysis_mode: str = "full_with_fallback"
    sample_size: int = 5000
    categorical_top_n: int = 20
    datetime_grain: str = "auto"
    outlier_method: str = "iqr"
    zscore_threshold: float = 3.0
    modified_zscore_threshold: float = 3.5
    target_column: str | None = None
    type_overrides: dict[str, str] = field(default_factory=dict)
    ordinal_orders: dict[str, list[Any]] = field(default_factory=dict)
    selected_column: str | None = None
    active_dataset_id: str | None = None
    chart_limit: int = 5000
    random_state: int = 42


def decode_dash_upload(contents: str, max_upload_mb: int = 100) -> bytes:
    if not contents:
        raise ValueError("No uploaded file contents were provided.")
    try:
        _, encoded = contents.split(",", 1)
    except ValueError as exc:
        raise ValueError("Upload payload is not a valid Dash upload.") from exc

    raw = base64.b64decode(encoded)
    max_bytes = max_upload_mb * 1024 * 1024
    if len(raw) > max_bytes:
        raise ValueError(f"File is larger than the {max_upload_mb} MB upload limit.")
    return raw


def read_csv_bytes(raw: bytes, config: EDAConfig, nrows: int | None = None) -> pd.DataFrame:
    header = None if config.header_row < 0 else config.header_row
    return pd.read_csv(
        io.BytesIO(raw),
        sep=_delimiter(config.delimiter),
        engine="python",
        encoding=config.encoding,
        header=header,
        nrows=nrows,
        on_bad_lines="skip",
    )


def read_csv_file(path: str | Path, config: EDAConfig, nrows: int | None = None) -> pd.DataFrame:
    header = None if config.header_row < 0 else config.header_row
    return pd.read_csv(
        path,
        sep=_delimiter(config.delimiter),
        engine="python",
        encoding=config.encoding,
        header=header,
        nrows=nrows,
        on_bad_lines="skip",
    )


def read_csv_sample(path: str | Path, config: EDAConfig, chunksize: int = 50_000) -> pd.DataFrame:
    sample_size = max(1, int(config.sample_size))
    header = None if config.header_row < 0 else config.header_row
    chunks = pd.read_csv(
        path,
        sep=_delimiter(config.delimiter),
        engine="python",
        encoding=config.encoding,
        header=header,
        chunksize=chunksize,
        on_bad_lines="skip",
    )
    samples: list[pd.DataFrame] = []
    for i, chunk in enumerate(chunks):
        if chunk.empty:
            continue
        take = min(len(chunk), sample_size)
        samples.append(chunk.sample(n=take, random_state=config.random_state + i))

    if not samples:
        return pd.DataFrame()

    combined = pd.concat(samples, ignore_index=True)
    if len(combined) > sample_size:
        return combined.sample(n=sample_size, random_state=config.random_state).reset_index(drop=True)
    return combined.reset_index(drop=True)


def load_and_analyze_csv(path: str | Path, config: EDAConfig) -> dict[str, Any]:
    if config.analysis_mode == "sample":
        sample = read_csv_sample(path, config)
        return generate_report(
            sample,
            config,
            source_rows=None,
            sampled_reason="Sample analysis selected.",
        )

    if config.analysis_mode == "full":
        full = read_csv_file(path, config)
        return generate_report(full, config, source_rows=len(full))

    try:
        full = read_csv_file(path, config)
        return generate_report(full, config, source_rows=len(full))
    except Exception as exc:
        sample = read_csv_sample(path, config)
        return generate_report(
            sample,
            replace(config, analysis_mode="sample"),
            source_rows=None,
            sampled_reason=f"Full analysis failed, so sampled analysis was used: {exc}",
        )


def analyze_with_fallback(
    df: pd.DataFrame,
    config: EDAConfig,
    analyzer: Callable[..., dict[str, Any]] = None,
) -> dict[str, Any]:
    analyzer = analyzer or generate_report
    source_rows = len(df)
    if config.analysis_mode == "sample":
        sample = _sample_frame(df, config.sample_size, config.random_state)
        return analyzer(
            sample,
            config,
            source_rows=source_rows,
            sampled_reason="Sample analysis selected.",
        )

    if config.analysis_mode == "full":
        return analyzer(df, config, source_rows=source_rows)

    try:
        return analyzer(df, config, source_rows=source_rows)
    except Exception as exc:
        sample = _sample_frame(df, config.sample_size, config.random_state)
        return analyzer(
            sample,
            replace(config, analysis_mode="sample"),
            source_rows=source_rows,
            sampled_reason=f"Full analysis failed, so sampled analysis was used: {exc}",
        )


def infer_column_types(df: pd.DataFrame, overrides: dict[str, str] | None = None) -> dict[str, str]:
    overrides = overrides or {}
    inferred: dict[str, str] = {}
    for column in df.columns:
        override = overrides.get(str(column))
        if override in SEMANTIC_TYPES:
            inferred[str(column)] = override
            continue

        series = df[column]
        if pd.api.types.is_bool_dtype(series):
            inferred[str(column)] = "boolean"
        elif _is_identifier_like(str(column), series):
            inferred[str(column)] = "identifier"
        elif pd.api.types.is_numeric_dtype(series) and not pd.api.types.is_bool_dtype(series):
            inferred[str(column)] = _numeric_or_numeric_category(series)
        elif pd.api.types.is_datetime64_any_dtype(series):
            inferred[str(column)] = "datetime"
        elif _is_boolean_like(series):
            inferred[str(column)] = "boolean"
        elif _is_datetime_like(series):
            inferred[str(column)] = "datetime"
        else:
            inferred[str(column)] = _categorical_or_text(series)
    return inferred


def generate_report(
    df: pd.DataFrame,
    config: EDAConfig,
    source_rows: int | None = None,
    sampled_reason: str | None = None,
) -> dict[str, Any]:
    source_rows = len(df) if source_rows is None else source_rows
    df = df.copy()
    df.columns = [str(col) for col in df.columns]
    column_types = infer_column_types(df, config.type_overrides)

    for column, semantic_type in column_types.items():
        if semantic_type == "datetime":
            df[column] = pd.to_datetime(df[column], errors="coerce")

    active_columns = [col for col, t in column_types.items() if t != "ignore"]
    numeric_columns = [col for col, t in column_types.items() if t == "numeric"]
    categorical_columns = [col for col, t in column_types.items() if t in {"categorical", "numeric_category", "ordinal"}]
    datetime_columns = [col for col, t in column_types.items() if t == "datetime"]
    boolean_columns = [col for col, t in column_types.items() if t == "boolean"]
    text_columns = [col for col, t in column_types.items() if t == "text"]
    identifier_columns = [col for col, t in column_types.items() if t == "identifier"]
    ignored_columns = [col for col, t in column_types.items() if t == "ignore"]

    sample = _sample_frame(df[active_columns], min(config.chart_limit, config.sample_size, 5000), config.random_state)

    report = {
        "meta": {
            "analysis_mode": config.analysis_mode,
            "is_sampled": sampled_reason is not None or len(df) < source_rows,
            "sampled_reason": sampled_reason,
            "source_rows": _json_value(source_rows),
            "analysis_rows": len(df),
            "chart_rows": len(sample),
            "target_column": config.target_column,
        },
        "shape": _shape_summary(df, source_rows),
        "info": _info_table(df, column_types),
        "nulls": _null_summary(df),
        "quality": quality_checks(df, column_types),
        "columns": {
            "types": column_types,
            "numeric": numeric_columns,
            "categorical": categorical_columns,
            "datetime": datetime_columns,
            "boolean": boolean_columns,
            "text": text_columns,
            "identifier": identifier_columns,
            "ignore": ignored_columns,
        },
        "numeric": _numeric_summary(df, numeric_columns, config),
        "categorical": _categorical_summary(df, categorical_columns, config.categorical_top_n, column_types, config.ordinal_orders),
        "datetime": _datetime_summary(df, datetime_columns, config.datetime_grain),
        "boolean": _boolean_summary(df, boolean_columns),
        "text": _text_summary(df, text_columns),
        "identifier": _identifier_summary(df, identifier_columns),
        "relationships": _relationships(df, numeric_columns, categorical_columns, datetime_columns, config.target_column),
        "column_details": _column_details(df, column_types, config),
        "chart_sample": _records(sample),
    }
    return _clean_for_json(report)


def detect_outliers(
    series: pd.Series,
    method: str = "iqr",
    zscore_threshold: float = 3.0,
    modified_zscore_threshold: float = 3.5,
) -> dict[str, Any]:
    clean = pd.to_numeric(series, errors="coerce").dropna()
    result = {
        "method": method,
        "lower_bound": None,
        "upper_bound": None,
        "outlier_count": 0,
        "outlier_pct": 0.0,
    }
    if clean.empty:
        return result

    if method == "zscore":
        mean = clean.mean()
        std = clean.std(ddof=0)
        if std == 0 or math.isnan(std):
            mask = pd.Series(False, index=clean.index)
            lower, upper = mean, mean
        else:
            lower = mean - zscore_threshold * std
            upper = mean + zscore_threshold * std
            mask = (clean < lower) | (clean > upper)
    elif method == "modified_zscore":
        median = clean.median()
        mad = (clean - median).abs().median()
        if mad == 0 or math.isnan(mad):
            lower, upper = median, median
            mask = clean != median
        else:
            lower = median - modified_zscore_threshold * mad / 0.6745
            upper = median + modified_zscore_threshold * mad / 0.6745
            modified = 0.6745 * (clean - median) / mad
            mask = modified.abs() > modified_zscore_threshold
    else:
        q1 = clean.quantile(0.25)
        q3 = clean.quantile(0.75)
        iqr = q3 - q1
        lower = q1 - 1.5 * iqr
        upper = q3 + 1.5 * iqr
        mask = (clean < lower) | (clean > upper)
        method = "iqr"

    count = int(mask.sum())
    result.update(
        {
            "method": method,
            "lower_bound": _round(lower),
            "upper_bound": _round(upper),
            "outlier_count": count,
            "outlier_pct": _round(count / len(clean) * 100),
        }
    )
    return result


def _delimiter(value: str) -> str | None:
    return DELIMITERS.get(value, value if value else None)


def _shape_summary(df: pd.DataFrame, source_rows: int) -> dict[str, Any]:
    memory = int(df.memory_usage(deep=True).sum())
    return {
        "rows": int(source_rows),
        "columns": int(df.shape[1]),
        "analysis_rows": int(df.shape[0]),
        "memory_bytes": memory,
        "memory_display": _format_bytes(memory),
        "duplicate_rows": int(df.duplicated().sum()),
    }


def _info_table(df: pd.DataFrame, column_types: dict[str, str]) -> list[dict[str, Any]]:
    rows = []
    for column in df.columns:
        series = df[column]
        rows.append(
            {
                "column": column,
                "semantic_type": column_types[column],
                "pandas_dtype": str(series.dtype),
                "non_null": int(series.notna().sum()),
                "nulls": int(series.isna().sum()),
                "null_pct": _round(series.isna().mean() * 100),
                "unique": int(series.nunique(dropna=True)),
                "sample_values": ", ".join(map(str, series.dropna().head(3).tolist())),
            }
        )
    return rows


def _null_summary(df: pd.DataFrame) -> list[dict[str, Any]]:
    rows = []
    for column in df.columns:
        missing = int(df[column].isna().sum())
        rows.append(
            {
                "column": column,
                "missing": missing,
                "missing_pct": _round(missing / len(df) * 100 if len(df) else 0),
                "present": int(df[column].notna().sum()),
            }
        )
    return sorted(rows, key=lambda row: row["missing_pct"], reverse=True)


def _numeric_summary(df: pd.DataFrame, columns: list[str], config: EDAConfig) -> dict[str, Any]:
    rows = []
    for column in columns:
        numeric = pd.to_numeric(df[column], errors="coerce")
        clean = numeric.dropna()
        outliers = detect_outliers(
            clean,
            method=config.outlier_method,
            zscore_threshold=config.zscore_threshold,
            modified_zscore_threshold=config.modified_zscore_threshold,
        )
        rows.append(
            {
                "column": column,
                "count": int(clean.count()),
                "mean": _round(clean.mean()),
                "std": _round(clean.std()),
                "min": _round(clean.min()),
                "q1": _round(clean.quantile(0.25)) if not clean.empty else None,
                "median": _round(clean.median()),
                "q3": _round(clean.quantile(0.75)) if not clean.empty else None,
                "max": _round(clean.max()),
                "skew": _round(clean.skew()),
                "zero_count": int((clean == 0).sum()),
                "negative_count": int((clean < 0).sum()),
                **outliers,
            }
        )

    return {"summary": rows, "outlier_method": config.outlier_method}


def _categorical_summary(
    df: pd.DataFrame,
    columns: list[str],
    top_n: int,
    column_types: dict[str, str],
    ordinal_orders: dict[str, list[Any]] | None = None,
) -> dict[str, Any]:
    ordinal_orders = ordinal_orders or {}
    summary = []
    value_counts: dict[str, list[dict[str, Any]]] = {}
    for column in columns:
        series = df[column]
        counts = series.dropna().astype(str).value_counts().head(top_n)
        if column_types.get(column) == "ordinal" and ordinal_orders.get(column):
            order = [str(value) for value in ordinal_orders[column]]
            counts = counts.reindex([value for value in order if value in counts.index]).dropna()
        elif column_types.get(column) == "numeric_category":
            try:
                counts = counts.sort_index(key=lambda index: pd.to_numeric(index, errors="coerce"))
            except Exception:
                counts = counts.sort_index()
        total = int(series.notna().sum())
        top_label = str(counts.index[0]) if len(counts) else None
        top_count = int(counts.iloc[0]) if len(counts) else 0
        summary.append(
            {
                "column": column,
                "semantic_type": column_types.get(column, "categorical"),
                "count": total,
                "unique": int(series.nunique(dropna=True)),
                "top": top_label,
                "top_count": top_count,
                "top_pct": _round(top_count / total * 100 if total else 0),
                "missing": int(series.isna().sum()),
                "cardinality_ratio": _round(series.nunique(dropna=True) / total if total else 0),
            }
        )
        value_counts[column] = [
            {"value": str(label), "count": int(count), "pct": _round(count / total * 100 if total else 0)}
            for label, count in counts.items()
        ]
    return {"summary": summary, "value_counts": value_counts}


def _identifier_summary(df: pd.DataFrame, columns: list[str]) -> dict[str, Any]:
    rows = []
    duplicate_examples: dict[str, list[dict[str, Any]]] = {}
    for column in columns:
        series = df[column]
        duplicates = series[series.notna() & series.duplicated(keep=False)].astype(str).value_counts().head(20)
        rows.append(
            {
                "column": column,
                "count": int(series.notna().sum()),
                "unique": int(series.nunique(dropna=True)),
                "duplicate_values": int(duplicates.shape[0]),
                "duplicate_rows": int(series.duplicated(keep=False).sum()),
                "missing": int(series.isna().sum()),
            }
        )
        duplicate_examples[column] = [
            {"value": str(label), "count": int(count)}
            for label, count in duplicates.items()
        ]
    return {"summary": rows, "duplicate_examples": duplicate_examples}


def _datetime_summary(df: pd.DataFrame, columns: list[str], grain: str) -> dict[str, Any]:
    summary = []
    frequencies: dict[str, list[dict[str, Any]]] = {}
    for column in columns:
        series = pd.to_datetime(df[column], errors="coerce").dropna()
        inferred = _infer_datetime_grain(series)
        selected_grain = inferred if grain == "auto" else grain
        bucketed = _bucket_datetime(series, selected_grain)
        counts = bucketed.value_counts().sort_index().head(200)
        min_value = series.min() if not series.empty else None
        max_value = series.max() if not series.empty else None
        span_days = None
        if min_value is not None and max_value is not None:
            span_days = _round((max_value - min_value).total_seconds() / 86_400)
        summary.append(
            {
                "column": column,
                "count": int(series.count()),
                "min": _iso(min_value),
                "max": _iso(max_value),
                "span_days": span_days,
                "unique": int(series.nunique()),
                "inferred_grain": inferred,
                "selected_grain": selected_grain,
                "unique_grain_count": int(bucketed.nunique()) if len(bucketed) else 0,
                "missing": int(df[column].isna().sum()),
            }
        )
        frequencies[column] = [
            {"bucket": str(bucket), "count": int(count)}
            for bucket, count in counts.items()
        ]
    return {"summary": summary, "frequencies": frequencies}


def _boolean_summary(df: pd.DataFrame, columns: list[str]) -> dict[str, Any]:
    summary = []
    counts: dict[str, list[dict[str, Any]]] = {}
    for column in columns:
        normalized = df[column].map(_normalize_bool)
        value_counts = normalized.dropna().value_counts()
        total = int(normalized.notna().sum())
        summary.append(
            {
                "column": column,
                "count": total,
                "true": int((normalized == True).sum()),
                "false": int((normalized == False).sum()),
                "true_pct": _round((normalized == True).sum() / total * 100 if total else 0),
                "missing": int(normalized.isna().sum()),
            }
        )
        counts[column] = [
            {"value": str(label), "count": int(count), "pct": _round(count / total * 100 if total else 0)}
            for label, count in value_counts.items()
        ]
    return {"summary": summary, "value_counts": counts}


def _text_summary(df: pd.DataFrame, columns: list[str]) -> dict[str, Any]:
    rows = []
    for column in columns:
        series = df[column].dropna().astype(str)
        lengths = series.str.len()
        rows.append(
            {
                "column": column,
                "count": int(series.count()),
                "unique": int(series.nunique()),
                "avg_length": _round(lengths.mean()),
                "median_length": _round(lengths.median()),
                "max_length": int(lengths.max()) if not lengths.empty else None,
                "empty_strings": int((series.str.strip() == "").sum()),
                "missing": int(df[column].isna().sum()),
            }
        )
    return {"summary": rows}


def quality_checks(df: pd.DataFrame, column_types: dict[str, str] | None = None) -> dict[str, Any]:
    column_types = column_types or {str(column): "unknown" for column in df.columns}
    duplicate_rows = int(df.duplicated().sum())
    constant_columns = [str(column) for column in df.columns if df[column].nunique(dropna=False) <= 1]
    high_missing_columns = [
        {"column": str(column), "missing_pct": _round(df[column].isna().mean() * 100)}
        for column in df.columns
        if len(df) and df[column].isna().mean() >= 0.5
    ]
    invalid = []
    for column, semantic_type in column_types.items():
        if semantic_type == "datetime":
            parsed = pd.to_datetime(df[column], errors="coerce")
            bad = int(df[column].notna().sum() - parsed.notna().sum())
            if bad:
                invalid.append({"column": column, "check": "datetime_parse", "invalid_count": bad})
        elif semantic_type == "numeric":
            parsed = pd.to_numeric(df[column], errors="coerce")
            bad = int(df[column].notna().sum() - parsed.notna().sum())
            if bad:
                invalid.append({"column": column, "check": "numeric_parse", "invalid_count": bad})
    return {
        "duplicate_rows": duplicate_rows,
        "constant_columns": constant_columns,
        "high_missing_columns": high_missing_columns,
        "invalid_values": invalid,
        "recommendations": _quality_recommendations(duplicate_rows, constant_columns, high_missing_columns, invalid),
    }


def _quality_recommendations(
    duplicate_rows: int,
    constant_columns: list[str],
    high_missing_columns: list[dict[str, Any]],
    invalid: list[dict[str, Any]],
) -> list[str]:
    recommendations = []
    if duplicate_rows:
        recommendations.append("Review duplicate rows and consider creating a de-duplicated derived dataset.")
    if high_missing_columns:
        recommendations.append("Review high-missing columns; consider dropping them or imputing values before modeling.")
    if constant_columns:
        recommendations.append("Constant columns usually add no analytical signal and can be ignored or removed.")
    if invalid:
        recommendations.append("Some values do not parse into their selected semantic type; inspect and correct or coerce them.")
    return recommendations


def _column_details(df: pd.DataFrame, column_types: dict[str, str], config: EDAConfig) -> dict[str, Any]:
    return {
        column: column_detail(df, column, column_types[column], config)
        for column in df.columns
        if column_types[column] != "ignore"
    }


def column_detail(df: pd.DataFrame, column: str, semantic_type: str, config: EDAConfig | None = None) -> dict[str, Any]:
    config = config or EDAConfig()
    series = df[column]
    base = {
        "column": column,
        "semantic_type": semantic_type,
        "pandas_dtype": str(series.dtype),
        "count": int(series.notna().sum()),
        "missing": int(series.isna().sum()),
        "missing_pct": _round(series.isna().mean() * 100 if len(series) else 0),
        "unique": int(series.nunique(dropna=True)),
        "notes": [],
        "metrics": [],
        "plot_kinds": [],
        "records": [],
    }
    if semantic_type == "numeric":
        clean = pd.to_numeric(series, errors="coerce").dropna()
        outliers = detect_outliers(clean, config.outlier_method, config.zscore_threshold, config.modified_zscore_threshold)
        base["metrics"] = [
            {"metric": "mean", "value": _round(clean.mean())},
            {"metric": "median", "value": _round(clean.median())},
            {"metric": "std", "value": _round(clean.std())},
            {"metric": "skew", "value": _round(clean.skew())},
            {"metric": "outlier_count", "value": outliers["outlier_count"]},
            {"metric": "outlier_pct", "value": outliers["outlier_pct"]},
        ]
        base["outliers"] = outliers
        base["plot_kinds"] = ["histogram", "box", "outlier_strip"]
    elif semantic_type in {"categorical", "numeric_category", "ordinal", "boolean"}:
        counts = series.dropna().astype(str).value_counts()
        if semantic_type == "numeric_category":
            counts = counts.sort_index(key=lambda index: pd.to_numeric(index, errors="coerce"))
        elif semantic_type == "ordinal" and config.ordinal_orders.get(column):
            order = [str(value) for value in config.ordinal_orders[column]]
            counts = counts.reindex([value for value in order if value in counts.index]).dropna()
        base["records"] = [
            {"value": str(label), "count": int(count), "pct": _round(count / series.notna().sum() * 100 if series.notna().sum() else 0)}
            for label, count in counts.head(config.categorical_top_n).items()
        ]
        base["metrics"] = [{"metric": "mode", "value": str(counts.index[0]) if len(counts) else None}]
        if semantic_type == "ordinal":
            numeric = pd.to_numeric(series, errors="coerce").dropna()
            if not numeric.empty:
                base["metrics"].append({"metric": "median", "value": _round(numeric.median())})
        base["plot_kinds"] = ["bar"]
    elif semantic_type == "datetime":
        clean = pd.to_datetime(series, errors="coerce").dropna()
        grain = _infer_datetime_grain(clean)
        bucketed = _bucket_datetime(clean, grain if grain != "unknown" else "day")
        counts = bucketed.value_counts().sort_index().head(200)
        base["metrics"] = [
            {"metric": "min", "value": _iso(clean.min() if not clean.empty else None)},
            {"metric": "max", "value": _iso(clean.max() if not clean.empty else None)},
            {"metric": "inferred_grain", "value": grain},
        ]
        base["records"] = [{"bucket": str(label), "count": int(count)} for label, count in counts.items()]
        base["plot_kinds"] = ["line"]
    elif semantic_type == "identifier":
        duplicates = series[series.notna() & series.duplicated(keep=False)].astype(str).value_counts().head(20)
        base["metrics"] = [
            {"metric": "duplicate_values", "value": int(duplicates.shape[0])},
            {"metric": "duplicate_rows", "value": int(series.duplicated(keep=False).sum())},
        ]
        base["records"] = [{"value": str(label), "count": int(count)} for label, count in duplicates.items()]
        base["notes"].append("Identifier columns are excluded from distribution and relationship charts by default.")
    elif semantic_type == "text":
        clean = series.dropna().astype(str)
        lengths = clean.str.len()
        base["metrics"] = [
            {"metric": "avg_length", "value": _round(lengths.mean())},
            {"metric": "max_length", "value": int(lengths.max()) if not lengths.empty else None},
            {"metric": "empty_strings", "value": int((clean.str.strip() == "").sum())},
        ]
        base["plot_kinds"] = ["length_histogram"]
    return _clean_for_json(base)


def _relationships(
    df: pd.DataFrame,
    numeric_columns: list[str],
    categorical_columns: list[str],
    datetime_columns: list[str],
    target_column: str | None,
) -> dict[str, Any]:
    result: dict[str, Any] = {
        "correlation": [],
        "target_correlations": [],
        "scatter_pairs": [],
        "line_pairs": [],
        "chi_square": [],
    }
    if len(numeric_columns) >= 2:
        numeric_df = df[numeric_columns].apply(pd.to_numeric, errors="coerce")
        corr = numeric_df.corr(numeric_only=True).round(3)
        result["correlation"] = [
            {"column": column, **{other: _json_value(value) for other, value in row.items()}}
            for column, row in corr.iterrows()
        ]
        result["scatter_pairs"] = [
            {"x": left, "y": right}
            for i, left in enumerate(numeric_columns[:5])
            for right in numeric_columns[i + 1 : i + 4]
        ]

        if target_column in numeric_columns:
            target_corr = corr[target_column].drop(labels=[target_column], errors="ignore").dropna()
            result["target_correlations"] = [
                {"column": column, "correlation": _round(value)}
                for column, value in target_corr.sort_values(key=lambda s: s.abs(), ascending=False).items()
            ]

    result["line_pairs"] = [
        {"x": date_col, "y": num_col}
        for date_col in datetime_columns[:3]
        for num_col in numeric_columns[:4]
    ]

    for i, left in enumerate(categorical_columns[:6]):
        for right in categorical_columns[i + 1 : i + 4]:
            result["chi_square"].append(_chi_square_test(df[left], df[right], left, right))
    return result


def _is_boolean_like(series: pd.Series) -> bool:
    values = {str(value).strip().lower() for value in series.dropna().unique()}
    if not values:
        return False
    accepted = {"true", "false", "yes", "no", "y", "n", "0", "1"}
    return len(values) <= 2 and values.issubset(accepted)


def _is_datetime_like(series: pd.Series) -> bool:
    sample = series.dropna().astype(str).head(200)
    if len(sample) < 2:
        return False
    pattern = re.compile(r"(\d{4}[-/]\d{1,2}[-/]\d{1,2})|(\d{1,2}[-/]\d{1,2}[-/]\d{2,4})|(T\d{2}:)|(\d{1,2}:\d{2})")
    looks_like_dates = sample.map(lambda value: bool(pattern.search(value))).mean()
    if looks_like_dates < 0.6:
        return False
    parsed = pd.to_datetime(sample, errors="coerce")
    return bool(parsed.notna().mean() >= 0.8)


def _is_identifier_like(column: str, series: pd.Series) -> bool:
    clean = series.dropna()
    if len(clean) < 10:
        return False
    unique_ratio = clean.nunique() / len(clean)
    name_hint = column.lower() in {"id", "uuid", "guid"} or column.lower().endswith(("_id", " id", "uuid"))
    return bool(name_hint and unique_ratio >= 0.95)


def _numeric_or_numeric_category(series: pd.Series) -> str:
    clean = pd.to_numeric(series, errors="coerce").dropna()
    if len(clean) >= 100:
        unique = clean.nunique()
        if unique <= 12 and unique / len(clean) <= 0.08:
            return "numeric_category"
    return "numeric"


def _categorical_or_text(series: pd.Series) -> str:
    clean = series.dropna().astype(str)
    if clean.empty:
        return "categorical"
    unique_ratio = clean.nunique() / len(clean)
    avg_len = clean.str.len().mean()
    if unique_ratio > 0.5 and avg_len > 30:
        return "text"
    return "categorical"


def _normalize_bool(value: Any) -> bool | None:
    if pd.isna(value):
        return None
    if isinstance(value, bool):
        return value
    text = str(value).strip().lower()
    if text in {"true", "yes", "y", "1"}:
        return True
    if text in {"false", "no", "n", "0"}:
        return False
    return None


def _chi_square_test(left: pd.Series, right: pd.Series, left_name: str, right_name: str) -> dict[str, Any]:
    table = pd.crosstab(left.fillna("__missing__").astype(str), right.fillna("__missing__").astype(str))
    result = {
        "left": left_name,
        "right": right_name,
        "rows": int(table.shape[0]),
        "columns": int(table.shape[1]),
        "chi2": None,
        "p_value": None,
        "dof": None,
    }
    if table.empty or table.shape[0] < 2 or table.shape[1] < 2:
        return result
    try:
        from scipy.stats import chi2_contingency

        chi2, p_value, dof, _expected = chi2_contingency(table)
        result.update({"chi2": _round(chi2), "p_value": _round(p_value, 6), "dof": int(dof)})
    except Exception:
        pass
    return result


def preview_join(
    left: pd.DataFrame,
    right: pd.DataFrame,
    left_keys: list[str],
    right_keys: list[str],
    how: str = "inner",
) -> dict[str, Any]:
    _validate_join(left, right, left_keys, right_keys, how)
    left_dupes = int(left.duplicated(subset=left_keys, keep=False).sum())
    right_dupes = int(right.duplicated(subset=right_keys, keep=False).sum())
    joined = join_dataframes(left, right, left_keys, right_keys, how)
    return {
        "left_rows": len(left),
        "right_rows": len(right),
        "joined_rows": len(joined),
        "joined_columns": len(joined.columns),
        "left_duplicate_key_rows": left_dupes,
        "right_duplicate_key_rows": right_dupes,
        "warnings": _join_warnings(left_dupes, right_dupes, how),
    }


def join_dataframes(
    left: pd.DataFrame,
    right: pd.DataFrame,
    left_keys: list[str],
    right_keys: list[str],
    how: str = "inner",
) -> pd.DataFrame:
    _validate_join(left, right, left_keys, right_keys, how)
    return left.merge(
        right,
        how=how,
        left_on=left_keys,
        right_on=right_keys,
        suffixes=("_left", "_right"),
    )


def _validate_join(left: pd.DataFrame, right: pd.DataFrame, left_keys: list[str], right_keys: list[str], how: str) -> None:
    if how not in JOIN_TYPES:
        raise ValueError(f"Join type must be one of: {', '.join(JOIN_TYPES)}")
    if not left_keys or not right_keys or len(left_keys) != len(right_keys):
        raise ValueError("Choose the same number of left and right join keys.")
    missing_left = [key for key in left_keys if key not in left.columns]
    missing_right = [key for key in right_keys if key not in right.columns]
    if missing_left or missing_right:
        raise ValueError(f"Missing join keys. Left: {missing_left}; right: {missing_right}")


def _join_warnings(left_dupes: int, right_dupes: int, how: str) -> list[str]:
    warnings = []
    if left_dupes or right_dupes:
        warnings.append("Duplicate key rows can create many-to-many joins and increase row count.")
    if how == "outer":
        warnings.append("Outer joins may introduce missing values for unmatched rows.")
    return warnings


def evaluate_custom_expression(df: pd.DataFrame, expression: str) -> pd.Series:
    expression = (expression or "").strip()
    if not expression:
        raise ValueError("Enter a pandas expression.")
    tree = ast.parse(expression, mode="eval")
    _validate_expression_ast(tree, set(df.columns))
    scope = {"pd": pd, "np": np, "abs": abs, "round": round, "min": min, "max": max, "col": lambda name: df[name]}
    scope.update({str(column): df[column] for column in df.columns if str(column).isidentifier()})
    result = eval(compile(tree, "<custom-field>", "eval"), {"__builtins__": {}}, scope)
    if isinstance(result, pd.Series):
        return result
    if np.isscalar(result):
        return pd.Series([result] * len(df), index=df.index)
    result = pd.Series(result, index=df.index if len(result) == len(df) else None)
    if len(result) != len(df):
        raise ValueError("Expression result must be scalar or match dataframe row count.")
    return result


def add_custom_field(df: pd.DataFrame, column_name: str, expression: str) -> pd.DataFrame:
    column_name = (column_name or "").strip()
    if not column_name:
        raise ValueError("Enter a new column name.")
    if column_name in df.columns:
        raise ValueError("Column already exists.")
    result = df.copy()
    result[column_name] = evaluate_custom_expression(result, expression)
    return result


def _validate_expression_ast(tree: ast.AST, columns: set[str]) -> None:
    blocked_nodes = (ast.Import, ast.ImportFrom, ast.Assign, ast.AugAssign, ast.Delete, ast.Lambda, ast.FunctionDef, ast.ClassDef)
    blocked_names = {"open", "exec", "eval", "__import__", "compile", "input", "globals", "locals", "os", "sys", "subprocess", "Path"}
    blocked_attrs = {"to_pickle", "to_csv", "to_parquet", "read_csv", "read_pickle", "read_parquet", "read_sql", "eval", "query"}
    for node in ast.walk(tree):
        if isinstance(node, blocked_nodes):
            raise ValueError("Only a single safe expression is allowed.")
        if isinstance(node, ast.Name) and node.id not in SAFE_EXPR_NAMES and node.id not in columns:
            raise ValueError(f"Name is not allowed in custom expression: {node.id}")
        if isinstance(node, ast.Name) and node.id in blocked_names:
            raise ValueError(f"Unsafe name is not allowed: {node.id}")
        if isinstance(node, ast.Attribute):
            if node.attr.startswith("_") or node.attr in blocked_attrs:
                raise ValueError(f"Unsafe attribute is not allowed: {node.attr}")


def apply_cleaning_action(df: pd.DataFrame, action: str, column: str | None = None, value: Any = None) -> pd.DataFrame:
    result = df.copy()
    if action == "drop_duplicates":
        return result.drop_duplicates().reset_index(drop=True)
    if action == "drop_missing_rows":
        return result.dropna(subset=[column] if column else None).reset_index(drop=True)
    if action == "drop_column":
        if column not in result.columns:
            raise ValueError("Column is required for drop_column.")
        return result.drop(columns=[column])
    if action in {"impute_mean", "impute_median", "impute_mode", "ffill", "bfill"}:
        if column not in result.columns:
            raise ValueError("Column is required for imputation.")
        if action == "impute_mean":
            fill = pd.to_numeric(result[column], errors="coerce").mean()
        elif action == "impute_median":
            fill = pd.to_numeric(result[column], errors="coerce").median()
        elif action == "impute_mode":
            mode = result[column].mode(dropna=True)
            fill = mode.iloc[0] if not mode.empty else value
        elif action == "ffill":
            result[column] = result[column].ffill()
            return result
        else:
            result[column] = result[column].bfill()
            return result
        result[column] = result[column].fillna(fill)
        return result
    if action in {"remove_iqr_outliers", "log_transform", "sqrt_transform"}:
        if column not in result.columns:
            raise ValueError("Column is required for outlier or transform action.")
        numeric = pd.to_numeric(result[column], errors="coerce")
        if action == "remove_iqr_outliers":
            bounds = detect_outliers(numeric, method="iqr")
            return result[(numeric >= bounds["lower_bound"]) & (numeric <= bounds["upper_bound"])].reset_index(drop=True)
        if action == "log_transform":
            result[f"{column}_log"] = np.log(numeric.where(numeric > 0))
        else:
            result[f"{column}_sqrt"] = np.sqrt(numeric.where(numeric >= 0))
        return result
    raise ValueError(f"Unknown cleaning action: {action}")


def _infer_datetime_grain(series: pd.Series) -> str:
    clean = pd.to_datetime(series, errors="coerce").dropna().sort_values()
    unique = clean.drop_duplicates()
    if len(unique) < 2:
        return "unknown"
    diffs = unique.diff().dropna().dt.total_seconds()
    if diffs.empty:
        return "unknown"
    median_seconds = diffs.median()
    if median_seconds <= 60:
        return "minute"
    if median_seconds <= 3_600:
        return "hour"
    if median_seconds <= 86_400:
        return "day"
    if median_seconds <= 604_800:
        return "week"
    if median_seconds <= 2_678_400:
        return "month"
    return "year"


def _bucket_datetime(series: pd.Series, grain: str) -> pd.Series:
    if series.empty:
        return pd.Series(dtype="object")
    if grain == "minute":
        return series.dt.floor("min").astype(str)
    if grain == "hour":
        return series.dt.floor("h").astype(str)
    if grain == "week":
        return series.dt.to_period("W").astype(str)
    if grain == "month":
        return series.dt.to_period("M").astype(str)
    if grain == "year":
        return series.dt.to_period("Y").astype(str)
    return series.dt.floor("D").astype(str)


def _sample_frame(df: pd.DataFrame, sample_size: int, random_state: int) -> pd.DataFrame:
    sample_size = max(1, int(sample_size))
    if len(df) <= sample_size:
        return df.copy()
    return df.sample(n=sample_size, random_state=random_state).reset_index(drop=True)


def _records(df: pd.DataFrame) -> list[dict[str, Any]]:
    return [{key: _json_value(value) for key, value in row.items()} for row in df.to_dict("records")]


def _round(value: Any, digits: int = 4) -> float | None:
    if value is None or pd.isna(value):
        return None
    return round(float(value), digits)


def _iso(value: Any) -> str | None:
    if value is None or pd.isna(value):
        return None
    if isinstance(value, pd.Timestamp):
        return value.isoformat()
    return str(value)


def _format_bytes(size: int) -> str:
    units = ["B", "KB", "MB", "GB"]
    value = float(size)
    for unit in units:
        if value < 1024 or unit == units[-1]:
            return f"{value:.1f} {unit}"
        value /= 1024
    return f"{value:.1f} GB"


def _json_value(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, (np.integer,)):
        return int(value)
    if isinstance(value, (np.floating,)):
        if math.isnan(float(value)) or math.isinf(float(value)):
            return None
        return float(value)
    if isinstance(value, (np.bool_,)):
        return bool(value)
    if isinstance(value, pd.Timestamp):
        return value.isoformat()
    if isinstance(value, pd.Timedelta):
        return str(value)
    if isinstance(value, float) and (math.isnan(value) or math.isinf(value)):
        return None
    if pd.isna(value) and not isinstance(value, (list, dict, tuple)):
        return None
    return value


def _clean_for_json(value: Any) -> Any:
    if isinstance(value, dict):
        return {str(key): _clean_for_json(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_clean_for_json(item) for item in value]
    if isinstance(value, tuple):
        return [_clean_for_json(item) for item in value]
    return _json_value(value)
