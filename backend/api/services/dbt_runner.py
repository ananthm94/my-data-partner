from __future__ import annotations

import io
import shutil
from pathlib import Path

import yaml
from dbt.cli.main import dbtRunner

from api.services.duckdb_manager import DATA_DIR

DBT_PROJECT_DIR = DATA_DIR / "dbt_project"


def _project_yml() -> dict:
    return {
        "name": "analytics_project",
        "version": "1.0.0",
        "profile": "analytics",
        "model-paths": ["models"],
        "target-path": "target",
        "clean-targets": ["target"],
    }


def _profiles_yml() -> dict:
    db_path = str(DATA_DIR / "warehouse.duckdb")
    return {
        "analytics": {
            "target": "dev",
            "outputs": {
                "dev": {
                    "type": "duckdb",
                    "path": db_path,
                }
            },
        }
    }


def init_dbt_project() -> None:
    DBT_PROJECT_DIR.mkdir(parents=True, exist_ok=True)
    (DBT_PROJECT_DIR / "models").mkdir(exist_ok=True)
    (DBT_PROJECT_DIR / "models" / "staging").mkdir(exist_ok=True)

    with open(DBT_PROJECT_DIR / "dbt_project.yml", "w") as f:
        yaml.dump(_project_yml(), f, default_flow_style=False)

    with open(DBT_PROJECT_DIR / "profiles.yml", "w") as f:
        yaml.dump(_profiles_yml(), f, default_flow_style=False)


def write_source_yaml(sources_yaml: str) -> None:
    init_dbt_project()
    (DBT_PROJECT_DIR / "models" / "sources.yml").write_text(sources_yaml)


def write_staging_models(models: dict[str, str]) -> None:
    staging_dir = DBT_PROJECT_DIR / "models" / "staging"
    staging_dir.mkdir(parents=True, exist_ok=True)
    for name, sql in models.items():
        fname = name if name.endswith(".sql") else f"{name}.sql"
        (staging_dir / fname).write_text(sql)


def write_semantic_layer(semantic_yaml: str) -> None:
    semantic_dir = DBT_PROJECT_DIR / "models" / "semantic"
    semantic_dir.mkdir(parents=True, exist_ok=True)
    (semantic_dir / "semantic_layer.yml").write_text(semantic_yaml)


def run_dbt(command: str = "run") -> dict:
    init_dbt_project()
    runner = dbtRunner()
    args = [
        command,
        "--project-dir", str(DBT_PROJECT_DIR),
        "--profiles-dir", str(DBT_PROJECT_DIR),
    ]

    log_buffer = io.StringIO()
    result = runner.invoke(args)

    logs = ""
    if result.result:
        try:
            entries = []
            for r in result.result:
                entries.append(f"{r.node.unique_id}: {r.status}" if hasattr(r, "node") else str(r))
            logs = "\n".join(entries)
        except (TypeError, AttributeError):
            logs = str(result.result)

    return {
        "success": result.success,
        "logs": logs,
    }


def get_run_results() -> dict | None:
    results_path = DBT_PROJECT_DIR / "target" / "run_results.json"
    if not results_path.exists():
        return None
    import json
    return json.loads(results_path.read_text())


def get_artifact(artifact_type: str) -> str | None:
    if artifact_type == "sources":
        path = DBT_PROJECT_DIR / "models" / "sources.yml"
    elif artifact_type == "semantic":
        path = DBT_PROJECT_DIR / "models" / "semantic" / "semantic_layer.yml"
    elif artifact_type == "staging":
        staging_dir = DBT_PROJECT_DIR / "models" / "staging"
        if not staging_dir.exists():
            return None
        parts = []
        for f in sorted(staging_dir.glob("*.sql")):
            parts.append(f"-- {f.name}\n{f.read_text()}")
        return "\n\n".join(parts) if parts else None
    else:
        return None
    return path.read_text() if path.exists() else None


def list_staging_models() -> dict[str, str]:
    staging_dir = DBT_PROJECT_DIR / "models" / "staging"
    if not staging_dir.exists():
        return {}
    return {f.stem: f.read_text() for f in sorted(staging_dir.glob("*.sql"))}


def reset() -> None:
    if DBT_PROJECT_DIR.exists():
        shutil.rmtree(DBT_PROJECT_DIR)
