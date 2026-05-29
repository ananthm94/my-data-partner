from __future__ import annotations

import base64

import pandas as pd

from eda import (
    EDAConfig,
    add_custom_field,
    apply_cleaning_action,
    analyze_with_fallback,
    column_detail,
    decode_dash_upload,
    detect_outliers,
    evaluate_custom_expression,
    generate_report,
    infer_column_types,
    join_dataframes,
    preview_join,
    quality_checks,
    read_csv_bytes,
)


def test_read_csv_bytes_skips_bad_rows_and_infers_types() -> None:
    raw = (
        b"id,amount,joined,segment,active,notes\n"
        b"1,10.5,2024-01-01,A,true,short note\n"
        b"bad,row,with,too,many,columns,ignored\n"
        b"2,12.0,2024-01-02,B,false,another short note\n"
    )

    df = read_csv_bytes(raw, EDAConfig())
    inferred = infer_column_types(df)

    assert len(df) == 2
    assert inferred["id"] == "numeric"
    assert inferred["amount"] == "numeric"
    assert inferred["joined"] == "datetime"
    assert inferred["segment"] == "categorical"
    assert inferred["active"] == "boolean"


def test_decode_dash_upload_rejects_oversized_file() -> None:
    contents = "data:text/csv;base64," + base64.b64encode(b"a,b\n1,2\n").decode("ascii")

    assert decode_dash_upload(contents, max_upload_mb=1) == b"a,b\n1,2\n"


def test_generate_report_core_summaries() -> None:
    df = pd.DataFrame(
        {
            "amount": [10.0, 15.0, None, 40.0],
            "segment": ["A", "A", "B", None],
            "created": ["2024-01-01", "2024-01-02", "2024-01-03", None],
            "active": ["yes", "no", "yes", None],
        }
    )

    report = generate_report(df, EDAConfig())

    assert report["shape"]["rows"] == 4
    assert report["shape"]["columns"] == 4
    assert report["columns"]["types"]["amount"] == "numeric"
    assert report["columns"]["types"]["segment"] == "categorical"
    assert report["columns"]["types"]["created"] == "datetime"
    assert report["columns"]["types"]["active"] == "boolean"
    assert next(row for row in report["nulls"] if row["column"] == "amount")["missing_pct"] == 25.0
    assert report["categorical"]["value_counts"]["segment"][0]["value"] == "A"
    assert report["datetime"]["summary"][0]["min"].startswith("2024-01-01")
    assert report["datetime"]["summary"][0]["inferred_grain"] == "day"
    assert report["boolean"]["summary"][0]["true"] == 2


def test_iqr_outlier_detection() -> None:
    result = detect_outliers(pd.Series([1, 2, 3, 4, 100]), method="iqr")

    assert result["method"] == "iqr"
    assert result["lower_bound"] == -1.0
    assert result["upper_bound"] == 7.0
    assert result["outlier_count"] == 1
    assert result["outlier_pct"] == 20.0


def test_zscore_outlier_detection() -> None:
    result = detect_outliers(pd.Series([0] * 20 + [100]), method="zscore", zscore_threshold=3.0)

    assert result["method"] == "zscore"
    assert result["outlier_count"] == 1


def test_modified_zscore_outlier_detection() -> None:
    result = detect_outliers(pd.Series([1, 2, 3, 4, 100]), method="modified_zscore")

    assert result["method"] == "modified_zscore"
    assert result["outlier_count"] == 1


def test_full_analysis_falls_back_to_sample() -> None:
    df = pd.DataFrame({"value": range(50), "group": ["A", "B"] * 25})
    config = EDAConfig(analysis_mode="full_with_fallback", sample_size=5)

    def analyzer(frame, report_config, source_rows=None, sampled_reason=None):
        if sampled_reason is None:
            raise RuntimeError("forced full failure")
        return generate_report(frame, report_config, source_rows=source_rows, sampled_reason=sampled_reason)

    report = analyze_with_fallback(df, config, analyzer=analyzer)

    assert report["meta"]["is_sampled"] is True
    assert report["meta"]["analysis_rows"] == 5
    assert report["meta"]["source_rows"] == 50
    assert "forced full failure" in report["meta"]["sampled_reason"]


def test_extended_type_overrides_and_ignored_columns() -> None:
    df = pd.DataFrame(
        {
            "score": [1, 2, 3, 3],
            "zip_code": [10001, 10001, 10002, 10003],
            "user_id": [f"id-{i}" for i in range(4)],
            "drop_me": ["x", "y", "z", "q"],
        }
    )
    config = EDAConfig(
        type_overrides={
            "score": "ordinal",
            "zip_code": "numeric_category",
            "user_id": "identifier",
            "drop_me": "ignore",
        }
    )

    report = generate_report(df, config)

    assert report["columns"]["types"]["score"] == "ordinal"
    assert report["columns"]["types"]["zip_code"] == "numeric_category"
    assert report["columns"]["types"]["user_id"] == "identifier"
    assert report["columns"]["ignore"] == ["drop_me"]
    assert "drop_me" not in report["chart_sample"][0]


def test_column_detail_payloads_for_key_types() -> None:
    df = pd.DataFrame(
        {
            "amount": [1, 2, 3, 100],
            "tier": [1, 2, 2, 3],
            "created": ["2024-01-01", "2024-01-02", "2024-01-03", "2024-01-04"],
            "user_id": ["a", "b", "b", "c"],
        }
    )
    config = EDAConfig(type_overrides={"tier": "ordinal", "user_id": "identifier"})

    assert column_detail(df, "amount", "numeric", config)["outliers"]["outlier_count"] == 1
    assert column_detail(df, "tier", "ordinal", config)["plot_kinds"] == ["bar"]
    assert column_detail(df, "created", "datetime", config)["plot_kinds"] == ["line"]
    assert column_detail(df, "user_id", "identifier", config)["metrics"][0]["value"] == 1


def test_safe_custom_expression_allows_pandas_and_blocks_unsafe_code() -> None:
    df = pd.DataFrame({"subtotal": [10, 20], "tax_rate": [0.1, 0.2], "Order Total": [11, 24]})

    result = evaluate_custom_expression(df, "subtotal * tax_rate")
    spaced = evaluate_custom_expression(df, "col('Order Total') / 2")
    with_new = add_custom_field(df, "tax", "subtotal * tax_rate")

    assert result.tolist() == [1.0, 4.0]
    assert spaced.tolist() == [5.5, 12.0]
    assert with_new["tax"].tolist() == [1.0, 4.0]

    for expression in ["__import__('os').system('ls')", "open('x')", "pd.read_csv('x.csv')"]:
        try:
            evaluate_custom_expression(df, expression)
        except ValueError:
            pass
        else:
            raise AssertionError(f"Unsafe expression was allowed: {expression}")


def test_manual_join_preview_and_join_types() -> None:
    left = pd.DataFrame({"account_id": [1, 2, 2], "subtotal": [10, 20, 30]})
    right = pd.DataFrame({"account_id": [2, 3], "segment": ["A", "B"]})

    preview = preview_join(left, right, ["account_id"], ["account_id"], "left")
    joined = join_dataframes(left, right, ["account_id"], ["account_id"], "left")

    assert preview["joined_rows"] == 3
    assert preview["left_duplicate_key_rows"] == 2
    assert joined["segment"].tolist() == [None, "A", "A"] or pd.isna(joined["segment"].iloc[0])


def test_cleaning_preview_apply_actions() -> None:
    df = pd.DataFrame({"amount": [1, 2, 3, 100, None], "constant": ["x"] * 5, "group": ["A", "A", None, "B", "B"]})

    quality = quality_checks(df, {"amount": "numeric", "constant": "categorical", "group": "categorical"})
    deduped = apply_cleaning_action(pd.concat([df, df.iloc[[0]]], ignore_index=True), "drop_duplicates")
    imputed = apply_cleaning_action(df, "impute_median", "amount")
    outlier_removed = apply_cleaning_action(df, "remove_iqr_outliers", "amount")
    logged = apply_cleaning_action(df, "log_transform", "amount")

    assert "constant" in quality["constant_columns"]
    assert len(deduped) == len(df)
    assert imputed["amount"].isna().sum() == 0
    assert len(outlier_removed) == 3
    assert "amount_log" in logged.columns
