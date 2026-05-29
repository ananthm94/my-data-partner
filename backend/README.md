# CSV EDA Workbench

A Plotly Dash app for uploading one or more CSV files and generating interactive exploratory data analysis for shape, info, nulls, column details, cleaning checks, relationships, joins, custom fields, and outliers.

## Features

- Multi-file CSV upload with in-app dataset tabs.
- Semantic type overrides including numeric, categorical, datetime, boolean, text, ordinal, numeric category, identifier, and ignore.
- Consolidated column detail view with metrics, missingness, histograms, value counts, time series, box plots, and outlier summaries.
- Manual join builder for inner, left, right, and outer joins.
- Safe custom field creator for pandas/numpy expressions such as `subtotal * 0.07` or `col('Order Total') / 100`.
- Cleaning previews and derived datasets for duplicate removal, missing-value handling, column drops, outlier removal, and transforms.
- Relationship checks including correlation heatmaps, scatter plots, line charts, and chi-square checks.

## Local Run

```bash
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -r requirements.txt
python app.py
```

Open `http://127.0.0.1:8050`.

## Render

Create a Render web service from this repository.

- Build command: `pip install -r requirements.txt`
- Start command: `gunicorn app:server --workers 1 --threads 4 --timeout 180`
- Optional environment variables:
  - `MAX_UPLOAD_MB`: upload size limit, default `100`
  - `EDA_UPLOAD_DIR`: temporary upload directory, default system temp

Uploads are stored in temporary per-session folders and cleaned up by age.
