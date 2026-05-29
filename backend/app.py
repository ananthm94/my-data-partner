from __future__ import annotations

import os
import shutil
import tempfile
import time
import uuid
from pathlib import Path
from typing import Any

import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
from dash import Dash, Input, Output, State, callback_context, dash_table, dcc, html, no_update

from eda import (
    EDAConfig,
    SEMANTIC_TYPES,
    add_custom_field,
    apply_cleaning_action,
    decode_dash_upload,
    generate_report,
    infer_column_types,
    join_dataframes,
    load_and_analyze_csv,
    preview_join,
    quality_checks,
    read_csv_file,
)


MAX_UPLOAD_MB = int(os.getenv("MAX_UPLOAD_MB", "100"))
UPLOAD_ROOT = Path(os.getenv("EDA_UPLOAD_DIR", tempfile.gettempdir())) / "dash-eda-uploads"
TYPE_OPTIONS = [{"label": "Auto", "value": "auto"}] + [
    {"label": value.title().replace("_", " "), "value": value} for value in SEMANTIC_TYPES
]

app = Dash(__name__, title="CSV EDA Workbench", suppress_callback_exceptions=True)
server = app.server


def control(label: str, component: Any) -> html.Label:
    return html.Label(className="control", children=[html.Span(label), component])


def panel(title: str, child: Any) -> html.Div:
    return html.Div(className="type-panel", children=[html.Div(title, className="section-title"), child])


app.layout = html.Div(
    className="app-shell",
    children=[
        dcc.Store(id="datasets-store", data=[]),
        dcc.Store(id="report-store"),
        html.Aside(
            className="sidebar",
            children=[
                html.Div(
                    className="brand-block",
                    children=[
                        html.Div("EDA", className="brand-mark"),
                        html.Div([html.H1("CSV EDA Workbench"), html.P("Multi-file profiling and joins.")]),
                    ],
                ),
                dcc.Upload(
                    id="upload-data",
                    className="upload-zone",
                    children=html.Div([html.Strong("Drop CSV files"), html.Span(" or select files")]),
                    multiple=True,
                ),
                html.Div(id="upload-status", className="status-line"),
                html.Div(
                    className="control-grid",
                    children=[
                        control("Delimiter", dcc.Dropdown(id="delimiter", value="auto", clearable=False, options=[
                            {"label": "Auto", "value": "auto"},
                            {"label": "Comma", "value": "comma"},
                            {"label": "Tab", "value": "tab"},
                            {"label": "Semicolon", "value": "semicolon"},
                            {"label": "Pipe", "value": "pipe"},
                        ])),
                        control("Encoding", dcc.Dropdown(id="encoding", value="utf-8", clearable=False, options=[
                            {"label": "UTF-8", "value": "utf-8"},
                            {"label": "Latin-1", "value": "latin-1"},
                            {"label": "Windows-1252", "value": "cp1252"},
                        ])),
                        control("Header Row", dcc.Input(id="header-row", type="number", value=0, min=-1, step=1)),
                        control("Mode", dcc.Dropdown(id="analysis-mode", value="full_with_fallback", clearable=False, options=[
                            {"label": "Full + fallback", "value": "full_with_fallback"},
                            {"label": "Full only", "value": "full"},
                            {"label": "Sample only", "value": "sample"},
                        ])),
                        control("Sample Rows", dcc.Input(id="sample-size", type="number", value=5000, min=100, step=100)),
                        control("Category Top N", dcc.Input(id="categorical-top-n", type="number", value=20, min=3, step=1)),
                        control("Date Grain", dcc.Dropdown(id="datetime-grain", value="auto", clearable=False, options=[
                            {"label": "Auto", "value": "auto"},
                            {"label": "Minute", "value": "minute"},
                            {"label": "Hour", "value": "hour"},
                            {"label": "Day", "value": "day"},
                            {"label": "Week", "value": "week"},
                            {"label": "Month", "value": "month"},
                            {"label": "Year", "value": "year"},
                        ])),
                        control("Outliers", dcc.Dropdown(id="outlier-method", value="iqr", clearable=False, options=[
                            {"label": "IQR fences", "value": "iqr"},
                            {"label": "Z-score", "value": "zscore"},
                            {"label": "Modified z-score", "value": "modified_zscore"},
                        ])),
                        control("Z Threshold", dcc.Input(id="zscore-threshold", type="number", value=3.0, min=0.5, step=0.1)),
                        control("Target", dcc.Dropdown(id="target-column", clearable=True)),
                    ],
                ),
                html.Button("Run Analysis", id="run-analysis", className="primary-action", n_clicks=0),
                panel("Column Types", dash_table.DataTable(
                    id="type-overrides",
                    columns=[
                        {"name": "Column", "id": "column", "editable": False},
                        {"name": "Inferred", "id": "inferred_type", "editable": False},
                        {"name": "Override", "id": "override", "presentation": "dropdown"},
                    ],
                    data=[],
                    dropdown={"override": {"options": TYPE_OPTIONS}},
                    editable=True,
                    page_size=8,
                    style_as_list_view=True,
                    style_table={"overflowX": "auto"},
                )),
                panel("Join Builder", html.Div(className="stack", children=[
                    control("Left Dataset", dcc.Dropdown(id="join-left")),
                    control("Right Dataset", dcc.Dropdown(id="join-right")),
                    control("Left Keys", dcc.Dropdown(id="join-left-keys", multi=True)),
                    control("Right Keys", dcc.Dropdown(id="join-right-keys", multi=True)),
                    control("Join Type", dcc.Dropdown(id="join-how", value="inner", clearable=False, options=[
                        {"label": item.title(), "value": item} for item in ["inner", "left", "right", "outer"]
                    ])),
                    control("Output Name", dcc.Input(id="join-name", value="joined_dataset")),
                    html.Div(className="button-row", children=[
                        html.Button("Preview", id="preview-join", n_clicks=0),
                        html.Button("Create", id="create-join", n_clicks=0),
                    ]),
                    html.Div(id="join-status", className="status-line"),
                ])),
                panel("Custom Field", html.Div(className="stack", children=[
                    control("New Column", dcc.Input(id="custom-name", placeholder="tax_amount")),
                    control("Expression", dcc.Textarea(id="custom-expression", placeholder="subtotal * 0.07 or col('Order Total') / 100")),
                    html.Div(className="button-row", children=[
                        html.Button("Preview", id="preview-custom", n_clicks=0),
                        html.Button("Apply", id="apply-custom", n_clicks=0),
                    ]),
                    html.Div(id="custom-status", className="status-line"),
                ])),
                panel("Cleaning", html.Div(className="stack", children=[
                    control("Action", dcc.Dropdown(id="clean-action", value="drop_duplicates", clearable=False, options=[
                        {"label": "Drop duplicate rows", "value": "drop_duplicates"},
                        {"label": "Drop missing rows", "value": "drop_missing_rows"},
                        {"label": "Drop column", "value": "drop_column"},
                        {"label": "Impute mean", "value": "impute_mean"},
                        {"label": "Impute median", "value": "impute_median"},
                        {"label": "Impute mode", "value": "impute_mode"},
                        {"label": "Forward fill", "value": "ffill"},
                        {"label": "Backward fill", "value": "bfill"},
                        {"label": "Remove IQR outliers", "value": "remove_iqr_outliers"},
                        {"label": "Log transform", "value": "log_transform"},
                        {"label": "Square-root transform", "value": "sqrt_transform"},
                    ])),
                    control("Column", dcc.Dropdown(id="clean-column")),
                    control("Output Name", dcc.Input(id="clean-name", value="cleaned_dataset")),
                    html.Div(className="button-row", children=[
                        html.Button("Preview", id="preview-clean", n_clicks=0),
                        html.Button("Apply", id="apply-clean", n_clicks=0),
                    ]),
                    html.Div(id="clean-status", className="status-line"),
                ])),
            ],
        ),
        html.Main(
            className="workspace",
            children=[
                html.Div(className="topbar", children=[
                    html.Div([html.Div("Dashboard", className="eyebrow"), html.H2("Exploratory data analysis")]),
                    html.Div(id="analysis-status", className="analysis-status"),
                ]),
                dcc.Tabs(id="dataset-tabs", value=None, children=[], className="dataset-tabs"),
                dcc.Tabs(id="tabs", value="overview", className="tabs", children=[
                    dcc.Tab(label="Overview", value="overview", children=html.Div(id="overview-tab", className="tab-panel")),
                    dcc.Tab(label="Column Detail", value="column-detail", children=html.Div(className="tab-panel", children=[
                        control("Column", dcc.Dropdown(id="column-detail-choice", clearable=False)),
                        html.Div(id="column-detail", className="detail-stack"),
                    ])),
                    dcc.Tab(label="Cleaning Checks", value="cleaning", children=html.Div(id="cleaning-tab", className="tab-panel")),
                    dcc.Tab(label="Relationships", value="relationships", children=html.Div(id="relationships-tab", className="tab-panel")),
                    dcc.Tab(label="Data Preview", value="preview", children=html.Div(id="preview-tab", className="tab-panel")),
                ]),
            ],
        ),
    ],
)


@app.callback(
    Output("datasets-store", "data"),
    Output("dataset-tabs", "children"),
    Output("dataset-tabs", "value"),
    Output("upload-status", "children"),
    Input("upload-data", "contents"),
    State("upload-data", "filename"),
    State("delimiter", "value"),
    State("encoding", "value"),
    State("header-row", "value"),
    State("datasets-store", "data"),
    prevent_initial_call=True,
)
def save_upload(contents, filenames, delimiter, encoding, header_row, datasets):
    if not contents:
        return no_update, no_update, no_update, ""
    datasets = datasets or []
    contents = contents if isinstance(contents, list) else [contents]
    filenames = filenames if isinstance(filenames, list) else [filenames]
    try:
        cleanup_uploads()
        session_id = str(uuid.uuid4())
        session_dir = UPLOAD_ROOT / session_id
        session_dir.mkdir(parents=True, exist_ok=True)
        created = []
        for content, filename in zip(contents, filenames):
            if filename and not filename.lower().endswith(".csv"):
                raise ValueError("Only CSV files are supported.")
            raw = decode_dash_upload(content, MAX_UPLOAD_MB)
            safe_name = Path(filename or "upload.csv").name
            path = session_dir / f"{uuid.uuid4().hex}_{safe_name}"
            path.write_bytes(raw)
            config = EDAConfig(delimiter=delimiter, encoding=encoding, header_row=int(header_row or 0))
            df = read_csv_file(path, config, nrows=1000)
            meta = dataset_meta(path, safe_name, df, derived_from="upload", parse=config)
            created.append(meta)
        datasets = datasets + created
        active = created[-1]["id"]
        return datasets, dataset_tabs(datasets), active, f"Added {len(created)} dataset(s)"
    except Exception as exc:
        return no_update, no_update, no_update, f"Upload failed: {exc}"


@app.callback(
    Output("type-overrides", "data"),
    Output("target-column", "options"),
    Output("column-detail-choice", "options"),
    Output("column-detail-choice", "value"),
    Output("join-left", "options"),
    Output("join-right", "options"),
    Output("clean-column", "options"),
    Input("dataset-tabs", "value"),
    Input("datasets-store", "data"),
)
def refresh_dataset_controls(active_id, datasets):
    active = find_dataset(datasets, active_id)
    dataset_options = [{"label": item["name"], "value": item["id"]} for item in datasets or []]
    if not active:
        return [], [], [], None, dataset_options, dataset_options, []
    df = read_dataset(active)
    inferred = infer_column_types(df)
    type_rows = [{"column": column, "inferred_type": inferred[column], "override": "auto"} for column in df.columns.astype(str)]
    column_options = [{"label": column, "value": column} for column in df.columns.astype(str)]
    return type_rows, column_options, column_options, column_options[0]["value"] if column_options else None, dataset_options, dataset_options, column_options


@app.callback(
    Output("join-left-keys", "options"),
    Output("join-right-keys", "options"),
    Input("join-left", "value"),
    Input("join-right", "value"),
    State("datasets-store", "data"),
)
def refresh_join_keys(left_id, right_id, datasets):
    left = find_dataset(datasets, left_id)
    right = find_dataset(datasets, right_id)
    return column_options(left), column_options(right)


@app.callback(
    Output("report-store", "data"),
    Output("analysis-status", "children"),
    Input("run-analysis", "n_clicks"),
    Input("dataset-tabs", "value"),
    State("datasets-store", "data"),
    State("delimiter", "value"),
    State("encoding", "value"),
    State("header-row", "value"),
    State("analysis-mode", "value"),
    State("sample-size", "value"),
    State("categorical-top-n", "value"),
    State("datetime-grain", "value"),
    State("outlier-method", "value"),
    State("zscore-threshold", "value"),
    State("target-column", "value"),
    State("type-overrides", "data"),
    prevent_initial_call=True,
)
def run_analysis(
    _clicks,
    active_id,
    datasets,
    delimiter,
    encoding,
    header_row,
    analysis_mode,
    sample_size,
    categorical_top_n,
    datetime_grain,
    outlier_method,
    zscore_threshold,
    target_column,
    type_rows,
):
    active = find_dataset(datasets, active_id)
    if not active:
        return no_update, "Upload a CSV first"
    try:
        overrides = {row["column"]: row.get("override") for row in type_rows or [] if row.get("override") in SEMANTIC_TYPES}
        config = EDAConfig(
            delimiter=delimiter,
            encoding=encoding,
            header_row=int(header_row or 0),
            analysis_mode=analysis_mode,
            sample_size=int(sample_size or 5000),
            categorical_top_n=int(categorical_top_n or 20),
            datetime_grain=datetime_grain,
            outlier_method=outlier_method,
            zscore_threshold=float(zscore_threshold or 3.0),
            target_column=target_column,
            type_overrides=overrides,
            active_dataset_id=active_id,
        )
        if active.get("format") == "csv":
            report = load_and_analyze_csv(active["path"], config)
        else:
            report = generate_report(read_dataset(active), config)
        status = f"{active['name']}: analyzed {report['shape']['analysis_rows']:,} rows"
        if report["meta"].get("sampled_reason"):
            status = f"{status} - sampled"
        return report, status
    except Exception as exc:
        return no_update, f"Analysis failed: {exc}"


@app.callback(
    Output("overview-tab", "children"),
    Output("column-detail-choice", "options", allow_duplicate=True),
    Output("column-detail-choice", "value", allow_duplicate=True),
    Output("cleaning-tab", "children"),
    Output("relationships-tab", "children"),
    Output("preview-tab", "children"),
    Input("report-store", "data"),
    prevent_initial_call=True,
)
def render_report(report):
    if not report:
        empty = empty_state()
        return empty, [], None, empty, empty, empty
    columns = [{"label": row["column"], "value": row["column"]} for row in report["info"]]
    return (
        render_overview(report),
        columns,
        columns[0]["value"] if columns else None,
        render_cleaning(report),
        render_relationships(report),
        data_table(report.get("chart_sample", [])[:25], page_size=10),
    )


@app.callback(Output("column-detail", "children"), Input("column-detail-choice", "value"), State("report-store", "data"))
def render_column_detail(column, report):
    if not report or not column:
        return empty_state()
    detail = report.get("column_details", {}).get(column)
    if not detail:
        return empty_state()
    sample = sample_frame(report)
    blocks = [
        html.Div(className="metric-grid compact", children=[
            metric("Type", detail["semantic_type"]),
            metric("Missing %", f"{detail['missing_pct']}%"),
            metric("Unique", detail["unique"]),
            metric("Dtype", detail["pandas_dtype"]),
        ]),
        data_table(detail.get("metrics", []), page_size=8),
    ]
    blocks.extend(render_detail_charts(column, detail, sample))
    if detail.get("records"):
        blocks.append(data_table(detail["records"], page_size=10))
    if detail.get("notes"):
        blocks.append(html.Div(" ".join(detail["notes"]), className="notice"))
    return html.Div(className="detail-stack", children=blocks)


@app.callback(
    Output("join-status", "children"),
    Input("preview-join", "n_clicks"),
    State("join-left", "value"),
    State("join-right", "value"),
    State("join-left-keys", "value"),
    State("join-right-keys", "value"),
    State("join-how", "value"),
    State("datasets-store", "data"),
    prevent_initial_call=True,
)
def preview_join_callback(_clicks, left_id, right_id, left_keys, right_keys, how, datasets):
    try:
        left, right = read_dataset(find_dataset(datasets, left_id)), read_dataset(find_dataset(datasets, right_id))
        preview = preview_join(left, right, left_keys or [], right_keys or [], how)
        warnings = "; ".join(preview["warnings"]) if preview["warnings"] else "No warnings"
        return f"Rows: {preview['left_rows']:,} + {preview['right_rows']:,} -> {preview['joined_rows']:,}. {warnings}"
    except Exception as exc:
        return f"Join preview failed: {exc}"


@app.callback(
    Output("datasets-store", "data", allow_duplicate=True),
    Output("dataset-tabs", "children", allow_duplicate=True),
    Output("dataset-tabs", "value", allow_duplicate=True),
    Output("join-status", "children", allow_duplicate=True),
    Input("create-join", "n_clicks"),
    State("join-left", "value"),
    State("join-right", "value"),
    State("join-left-keys", "value"),
    State("join-right-keys", "value"),
    State("join-how", "value"),
    State("join-name", "value"),
    State("datasets-store", "data"),
    prevent_initial_call=True,
)
def create_join_callback(_clicks, left_id, right_id, left_keys, right_keys, how, name, datasets):
    try:
        left_meta, right_meta = find_dataset(datasets, left_id), find_dataset(datasets, right_id)
        joined = join_dataframes(read_dataset(left_meta), read_dataset(right_meta), left_keys or [], right_keys or [], how)
        meta = save_derived_dataset(joined, name or "joined_dataset", f"join:{left_meta['name']}:{right_meta['name']}")
        updated = (datasets or []) + [meta]
        return updated, dataset_tabs(updated), meta["id"], f"Created {meta['name']} with {len(joined):,} rows"
    except Exception as exc:
        return no_update, no_update, no_update, f"Join failed: {exc}"


@app.callback(
    Output("custom-status", "children"),
    Input("preview-custom", "n_clicks"),
    State("dataset-tabs", "value"),
    State("custom-name", "value"),
    State("custom-expression", "value"),
    State("datasets-store", "data"),
    prevent_initial_call=True,
)
def preview_custom_callback(_clicks, active_id, name, expression, datasets):
    try:
        df = add_custom_field(read_dataset(find_dataset(datasets, active_id)), name or "__preview__", expression)
        preview = df[name or "__preview__"].head(5).tolist()
        return f"Preview values: {preview}"
    except Exception as exc:
        return f"Custom field preview failed: {exc}"


@app.callback(
    Output("datasets-store", "data", allow_duplicate=True),
    Output("dataset-tabs", "children", allow_duplicate=True),
    Output("dataset-tabs", "value", allow_duplicate=True),
    Output("custom-status", "children", allow_duplicate=True),
    Input("apply-custom", "n_clicks"),
    State("dataset-tabs", "value"),
    State("custom-name", "value"),
    State("custom-expression", "value"),
    State("datasets-store", "data"),
    prevent_initial_call=True,
)
def apply_custom_callback(_clicks, active_id, name, expression, datasets):
    try:
        active = find_dataset(datasets, active_id)
        df = add_custom_field(read_dataset(active), name, expression)
        meta = save_derived_dataset(df, f"{active['name']}_with_{name}", f"custom:{active['name']}")
        updated = (datasets or []) + [meta]
        return updated, dataset_tabs(updated), meta["id"], f"Created {name}"
    except Exception as exc:
        return no_update, no_update, no_update, f"Custom field failed: {exc}"


@app.callback(
    Output("clean-status", "children"),
    Input("preview-clean", "n_clicks"),
    State("dataset-tabs", "value"),
    State("clean-action", "value"),
    State("clean-column", "value"),
    State("datasets-store", "data"),
    prevent_initial_call=True,
)
def preview_clean_callback(_clicks, active_id, action, column, datasets):
    try:
        df = read_dataset(find_dataset(datasets, active_id))
        cleaned = apply_cleaning_action(df, action, column)
        return f"Preview: {len(df):,} rows x {len(df.columns):,} cols -> {len(cleaned):,} rows x {len(cleaned.columns):,} cols"
    except Exception as exc:
        return f"Cleaning preview failed: {exc}"


@app.callback(
    Output("datasets-store", "data", allow_duplicate=True),
    Output("dataset-tabs", "children", allow_duplicate=True),
    Output("dataset-tabs", "value", allow_duplicate=True),
    Output("clean-status", "children", allow_duplicate=True),
    Input("apply-clean", "n_clicks"),
    State("dataset-tabs", "value"),
    State("clean-action", "value"),
    State("clean-column", "value"),
    State("clean-name", "value"),
    State("datasets-store", "data"),
    prevent_initial_call=True,
)
def apply_clean_callback(_clicks, active_id, action, column, name, datasets):
    try:
        active = find_dataset(datasets, active_id)
        cleaned = apply_cleaning_action(read_dataset(active), action, column)
        meta = save_derived_dataset(cleaned, name or f"{active['name']}_{action}", f"clean:{active['name']}:{action}")
        updated = (datasets or []) + [meta]
        return updated, dataset_tabs(updated), meta["id"], f"Created {meta['name']}"
    except Exception as exc:
        return no_update, no_update, no_update, f"Cleaning failed: {exc}"


def dataset_meta(path: Path, name: str, df: pd.DataFrame, derived_from: str, parse: EDAConfig | None = None) -> dict[str, Any]:
    parse = parse or EDAConfig()
    return {
        "id": uuid.uuid4().hex,
        "name": name,
        "path": str(path),
        "format": "csv",
        "rows": int(len(df)),
        "columns": [str(column) for column in df.columns],
        "derived_from": derived_from,
        "created_at": int(time.time()),
        "parse": {"delimiter": parse.delimiter, "encoding": parse.encoding, "header_row": parse.header_row},
    }


def save_derived_dataset(df: pd.DataFrame, name: str, derived_from: str) -> dict[str, Any]:
    session_dir = UPLOAD_ROOT / "derived"
    session_dir.mkdir(parents=True, exist_ok=True)
    safe_name = f"{uuid.uuid4().hex}_{Path(name).stem or 'derived'}.csv"
    path = session_dir / safe_name
    df.to_csv(path, index=False)
    return dataset_meta(path, Path(name).stem or "derived", df, derived_from)


def read_dataset(meta: dict[str, Any] | None) -> pd.DataFrame:
    if not meta:
        raise ValueError("Choose a dataset first.")
    parse = meta.get("parse") or {}
    config = EDAConfig(
        delimiter=parse.get("delimiter", "comma"),
        encoding=parse.get("encoding", "utf-8"),
        header_row=int(parse.get("header_row", 0)),
    )
    return read_csv_file(meta["path"], config)


def find_dataset(datasets: list[dict[str, Any]] | None, dataset_id: str | None) -> dict[str, Any] | None:
    for item in datasets or []:
        if item.get("id") == dataset_id:
            return item
    return None


def dataset_tabs(datasets: list[dict[str, Any]]) -> list[dcc.Tab]:
    return [dcc.Tab(label=f"{item['name']} ({item['rows']:,})", value=item["id"]) for item in datasets or []]


def column_options(meta: dict[str, Any] | None) -> list[dict[str, str]]:
    return [{"label": column, "value": column} for column in (meta or {}).get("columns", [])]


def cleanup_uploads(max_age_hours: int = 6) -> None:
    if not UPLOAD_ROOT.exists():
        return
    cutoff = time.time() - max_age_hours * 3600
    for child in UPLOAD_ROOT.iterdir():
        try:
            if child.stat().st_mtime < cutoff:
                shutil.rmtree(child) if child.is_dir() else child.unlink()
        except OSError:
            continue


def render_overview(report: dict[str, Any]) -> html.Div:
    shape = report["shape"]
    type_rows = [{"type": key, "columns": ", ".join(values) or "-"} for key, values in report["columns"].items() if key != "types"]
    reason = report["meta"].get("sampled_reason")
    return html.Div(children=[
        html.Div(className="metric-grid", children=[
            metric("Rows", f"{shape['rows']:,}"),
            metric("Columns", f"{shape['columns']:,}"),
            metric("Analysis Rows", f"{shape['analysis_rows']:,}"),
            metric("Memory", shape["memory_display"]),
            metric("Duplicates", f"{shape['duplicate_rows']:,}"),
            metric("Chart Rows", f"{report['meta']['chart_rows']:,}"),
        ]),
        html.Div(reason, className="notice") if reason else html.Div(),
        html.Div("Column Groups", className="section-title"),
        data_table(type_rows, page_size=10),
        html.Div("Info", className="section-title"),
        data_table(report["info"], page_size=12),
        html.Div("Nulls", className="section-title"),
        graph(px.bar(report["nulls"], x="column", y="missing_pct", title="Missing values by column")),
        data_table(report["nulls"], page_size=12),
    ])


def render_cleaning(report: dict[str, Any]) -> html.Div:
    quality = report.get("quality") or {}
    cards = [
        metric("Duplicate Rows", quality.get("duplicate_rows", 0)),
        metric("Constant Columns", len(quality.get("constant_columns", []))),
        metric("High Missing", len(quality.get("high_missing_columns", []))),
        metric("Invalid Checks", len(quality.get("invalid_values", []))),
    ]
    return html.Div(children=[
        html.Div(className="metric-grid compact", children=cards),
        html.Div("Recommendations", className="section-title"),
        data_table([{"recommendation": item} for item in quality.get("recommendations", [])] or [{"recommendation": "No major cleaning checks triggered."}], page_size=8),
        html.Div("High Missing Columns", className="section-title"),
        data_table(quality.get("high_missing_columns", []), page_size=8),
        html.Div("Invalid Values", className="section-title"),
        data_table(quality.get("invalid_values", []), page_size=8),
    ])


def render_relationships(report: dict[str, Any]) -> html.Div:
    rel = report.get("relationships") or {}
    children = []
    corr = rel.get("correlation") or []
    sample = sample_frame(report)
    if corr:
        corr_df = pd.DataFrame(corr).set_index("column")
        fig = go.Figure(data=go.Heatmap(z=corr_df.values, x=corr_df.columns, y=corr_df.index, colorscale="RdBu", zmin=-1, zmax=1))
        fig.update_layout(title="Correlation heatmap")
        children.append(graph(fig))
        children.append(data_table(corr, page_size=10))
    for pair in (rel.get("scatter_pairs") or [])[:4]:
        if pair["x"] in sample and pair["y"] in sample:
            children.append(graph(px.scatter(sample, x=pair["x"], y=pair["y"], title=f"{pair['x']} vs {pair['y']}")))
    for pair in (rel.get("line_pairs") or [])[:4]:
        if pair["x"] in sample and pair["y"] in sample:
            temp = sample.copy()
            temp[pair["x"]] = pd.to_datetime(temp[pair["x"]], errors="coerce")
            children.append(graph(px.line(temp.sort_values(pair["x"]), x=pair["x"], y=pair["y"], title=f"{pair['y']} over {pair['x']}")))
    if rel.get("chi_square"):
        children.append(html.Div("Chi-Square Checks", className="section-title"))
        children.append(data_table(rel["chi_square"], page_size=10))
    return html.Div(children=children or [empty_state()])


def render_detail_charts(column: str, detail: dict[str, Any], sample: pd.DataFrame) -> list[Any]:
    charts = []
    semantic_type = detail["semantic_type"]
    if semantic_type == "numeric" and column in sample:
        numeric = pd.to_numeric(sample[column], errors="coerce").dropna()
        charts.append(graph(px.histogram(numeric, x=column, nbins=40, title=f"{column} histogram")))
        charts.append(graph(px.box(numeric, y=column, title=f"{column} box plot")))
        charts.append(graph(px.strip(numeric, y=column, title=f"{column} outlier strip")))
    elif semantic_type in {"categorical", "numeric_category", "ordinal", "boolean"}:
        charts.append(graph_from_records(detail.get("records", []), "value", "count", f"{column} value counts"))
    elif semantic_type == "datetime":
        charts.append(graph_from_records(detail.get("records", []), "bucket", "count", f"{column} over time", kind="line"))
    elif semantic_type == "text" and column in sample:
        lengths = sample[column].dropna().astype(str).str.len()
        charts.append(graph(px.histogram(lengths, x=column, title=f"{column} text length distribution")))
    return charts


def data_table(rows: list[dict[str, Any]], page_size: int = 10) -> html.Div:
    if not rows:
        return html.Div("No rows available.", className="empty-state")
    columns = [{"name": titleize(key), "id": key} for key in rows[0].keys()]
    return html.Div(className="table-wrap", children=[dash_table.DataTable(
        data=rows,
        columns=columns,
        page_size=page_size,
        sort_action="native",
        filter_action="native",
        style_as_list_view=True,
        style_table={"overflowX": "auto"},
        style_cell={"fontFamily": "Inter, system-ui, sans-serif", "fontSize": "13px", "padding": "9px", "maxWidth": "260px", "overflow": "hidden", "textOverflow": "ellipsis"},
        style_header={"fontWeight": "700"},
    )])


def graph_from_records(records: list[dict[str, Any]], x: str, y: str, title: str, kind: str = "bar") -> html.Div:
    if not records:
        return html.Div("No chart data available.", className="empty-state")
    fig = px.line(records, x=x, y=y, title=title) if kind == "line" else px.bar(records, x=x, y=y, title=title)
    return graph(fig)


def graph(fig: go.Figure) -> html.Div:
    fig.update_layout(template="plotly_white", margin={"l": 48, "r": 24, "t": 58, "b": 58}, font={"family": "Inter, system-ui, sans-serif"}, title_font={"size": 16})
    return html.Div(className="chart-card", children=[dcc.Graph(figure=fig, config={"displayModeBar": False})])


def metric(label: str, value: Any) -> html.Div:
    return html.Div(className="metric", children=[html.Span(label), html.Strong(str(value))])


def empty_state() -> html.Div:
    return html.Div(className="empty-state", children=["Upload a CSV and run analysis to populate this view."])


def sample_frame(report: dict[str, Any]) -> pd.DataFrame:
    return pd.DataFrame(report.get("chart_sample", []))


def titleize(value: str) -> str:
    return value.replace("_", " ").title()


if __name__ == "__main__":
    app.run(debug=True)
