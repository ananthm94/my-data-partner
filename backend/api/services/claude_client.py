from __future__ import annotations

import os
from typing import Any

import anthropic
import pandas as pd

_client: anthropic.Anthropic | None = None

SUGGEST_TOOL = {
    "name": "suggest_transformations",
    "description": "Return dataset transformation suggestions as structured JSON.",
    "input_schema": {
        "type": "object",
        "properties": {
            "renames": {
                "type": "object",
                "description": "Map of old column name to clean snake_case name.",
                "additionalProperties": {"type": "string"},
            },
            "type_casts": {
                "type": "object",
                "description": "Map of column name to target pandas dtype string.",
                "additionalProperties": {
                    "type": "string",
                    "enum": ["int64", "float64", "datetime64[ns]", "category", "boolean"],
                },
            },
            "imputations": {
                "type": "object",
                "description": "Map of column name to imputation strategy.",
                "additionalProperties": {
                    "type": "string",
                    "enum": ["median", "mean", "mode", "drop"],
                },
            },
        },
        "required": ["renames", "type_casts", "imputations"],
    },
}

SYSTEM_PROMPT = """\
You are an expert data engineer AI. You will be provided with a 100-row sample of a dataset \
in CSV format and an optional user description of their business context.
Your job is to call the suggest_transformations tool with optimization configurations.
Only suggest renames that would improve clarity (e.g. fixing unclear abbreviations or adding snake_case).
Only suggest type casts where the inferred type is clearly wrong.
Only suggest imputations for columns with missing values where a strategy makes sense.
Leave keys empty ({}) if there is nothing meaningful to suggest."""


def ai_available() -> bool:
    return bool(os.environ.get("ANTHROPIC_API_KEY"))


def _get_client() -> anthropic.Anthropic:
    global _client
    if _client is None:
        key = os.environ.get("ANTHROPIC_API_KEY")
        if not key:
            raise RuntimeError("ANTHROPIC_API_KEY is not set.")
        _client = anthropic.Anthropic(api_key=key)
    return _client


def suggest_transforms(df: pd.DataFrame, user_context: str = "") -> dict[str, Any]:
    sample = df.head(100).to_csv(index=False)
    user_msg = f"Dataset sample (CSV):\n```\n{sample}\n```"
    if user_context.strip():
        user_msg += f"\n\nBusiness context: {user_context.strip()}"

    client = _get_client()
    response = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=2048,
        system=SYSTEM_PROMPT,
        tools=[SUGGEST_TOOL],
        tool_choice={"type": "any"},
        messages=[{"role": "user", "content": user_msg}],
    )

    for block in response.content:
        if block.type == "tool_use" and block.name == "suggest_transformations":
            inp = block.input
            return {
                "renames": inp.get("renames", {}),
                "type_casts": inp.get("type_casts", {}),
                "imputations": inp.get("imputations", {}),
            }

    return {"renames": {}, "type_casts": {}, "imputations": {}}
