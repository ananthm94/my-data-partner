# myDataPartner

AI-powered data platform with two paths:

- **ML Model Prep** — Upload a CSV, get AI-suggested cleaning and transformations, explore with interactive profiling dashboards.
- **Analytics Agent** — Upload CSVs into a DuckDB warehouse, auto-generate a dbt pipeline and semantic layer, then ask questions in natural language via a ReAct AI agent.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Single Docker Container                 │
│                                                             │
│   nginx (:8000)                                             │
│   ├── /api/*  →  FastAPI backend (:8001)                    │
│   └── /*      →  Next.js frontend (:3000)                   │
│                                                             │
│   Backend services:                                         │
│   ├── DuckDB (embedded warehouse)                           │
│   ├── dbt-core + dbt-duckdb (transformations)               │
│   ├── LangChain + LangGraph (multi-LLM orchestration)       │
│   └── Session manager (ML path cleanup)                     │
│                                                             │
│   Data volume: /app/data (persistent across restarts)       │
└─────────────────────────────────────────────────────────────┘
```

**Tech stack:**
- **Backend:** Python 3.12, FastAPI, DuckDB, dbt-core, LangChain, LangGraph
- **Frontend:** Next.js 15, React 19, Tailwind CSS 4, Recharts
- **Infra:** Docker, nginx, supervisord

---

## Quick Start

### Option A: Docker (recommended for sharing/demos)

**1. Build the image (one time, or after code changes):**

```bash
docker build -t mydatapartner .
```

**2. Run the container:**

```bash
docker run -d \
  --name mydatapartner \
  -p 8000:8000 \
  -v ./myproject:/app/data \
  mydatapartner
```

**3. Open** http://localhost:8000

**Key flags explained:**

| Flag | Purpose |
|------|---------|
| `-d` | Run in background (detached) |
| `--name mydatapartner` | Give the container a fixed name so you can stop/start it without creating duplicates |
| `-p 8000:8000` | Map port 8000 on your machine to port 8000 in the container |
| `-v ./myproject:/app/data` | Mount `./myproject` as the data directory — your DuckDB database, dbt project, and pipeline state persist here across container restarts |

**Stop and restart (no new container, keeps data):**

```bash
docker stop mydatapartner
docker start mydatapartner
```

**View logs:**

```bash
docker logs -f mydatapartner
```

**After code changes — rebuild and replace:**

```bash
docker stop mydatapartner
docker rm mydatapartner
docker build -t mydatapartner .
docker run -d --name mydatapartner -p 8000:8000 -v ./myproject:/app/data mydatapartner
```

Your data in `./myproject` is preserved because it lives on your machine, not inside the container.

**Full reset (delete all data):**

```bash
docker stop mydatapartner && docker rm mydatapartner
rm -rf ./myproject
docker run -d --name mydatapartner -p 8000:8000 -v ./myproject:/app/data mydatapartner
```

---

### Option B: Local Development (recommended for active development)

**Prerequisites:**
- Python 3.12+
- Node.js 22+

**1. Backend setup:**

```bash
cd backend
python -m venv .venv
source .venv/bin/activate       # On Windows: .venv\Scripts\activate
pip install -r requirements-api.txt
```

**2. Frontend setup:**

```bash
cd frontend
npm install
```

**3. Start both servers (two terminal windows):**

Terminal 1 — Backend:
```bash
cd backend
source .venv/bin/activate
uvicorn api.main:app --host 0.0.0.0 --port 8001 --reload
```

Terminal 2 — Frontend:
```bash
cd frontend
npm run dev
```

**4. Open** http://localhost:3000

In local dev mode, the Next.js dev server proxies `/api/*` requests to the backend on port 8001 (configured in `frontend/next.config.ts`). Changes to either codebase auto-reload.

---

## Project Structure

```
myDataPartner/
├── backend/
│   ├── api/
│   │   ├── main.py                    # FastAPI app, CORS, router registration
│   │   ├── models/
│   │   │   └── analytics_schemas.py   # Pydantic models for analytics API
│   │   ├── routers/
│   │   │   ├── analytics.py           # Analytics pipeline endpoints
│   │   │   ├── upload.py              # ML path: file upload
│   │   │   ├── transform.py           # ML path: data transformations
│   │   │   ├── profile.py             # ML path: column profiling
│   │   │   ├── analyze.py             # ML path: relationship analysis
│   │   │   └── ...                    # Other ML path routers
│   │   └── services/
│   │       ├── analytics_graph.py     # LangGraph pipeline + ReAct agent
│   │       ├── duckdb_manager.py      # DuckDB connection + table management
│   │       ├── dbt_runner.py          # dbt-core programmatic runner
│   │       ├── llm_client.py          # LangChain multi-provider LLM factory
│   │       └── session.py             # ML path session cleanup
│   ├── data/                          # Default data dir (local dev)
│   └── requirements-api.txt
├── frontend/
│   ├── app/
│   │   ├── page.tsx                   # Landing page (path selection)
│   │   ├── analytics/page.tsx         # Analytics Agent wizard + chat
│   │   ├── upload/page.tsx            # ML path: upload + transform wizard
│   │   └── dashboard/[sessionId]/     # ML path: profiling dashboard
│   ├── lib/
│   │   ├── api.ts                     # All API call functions + types
│   │   └── sampler.ts                 # Client-side CSV sampling for large files
│   └── components/                    # Shared UI components
├── myproject/                         # Data volume (git-ignored)
│   ├── warehouse.duckdb               # DuckDB database file
│   ├── pipeline_state.json            # Analytics pipeline state
│   └── dbt_project/                   # Generated dbt project
├── Dockerfile                         # Multi-stage build
├── nginx.conf                         # Reverse proxy config
├── supervisord.conf                   # Process manager config
└── .dockerignore
```

---

## Analytics Agent Pipeline

The analytics path is a 5-step wizard:

| Step | What happens | Backend |
|------|-------------|---------|
| **1. Upload** | CSV files loaded into DuckDB — one table per file | `duckdb_manager.load_csv_to_table()` |
| **2. Sources** | LLM generates `sources.yml` describing raw tables | `analytics_graph.generate_sources()` |
| **3. Staging** | LLM generates `stg_*.sql` models, dbt runs them | `analytics_graph.generate_staging()` |
| **4. Semantic** | LLM creates semantic layer (entities, dimensions, measures) | `analytics_graph.generate_semantic_layer()` |
| **5. Chat** | ReAct agent answers questions using SQL | `analytics_graph.chat()` |

### Chat Agent Capabilities

The ReAct agent has four tools:
- `run_sql` — Execute SQL against DuckDB
- `get_schema` — List all tables and columns
- `profile_column` — Statistical profile of a column (nulls, outliers, distribution)
- `detect_outliers` — IQR-based outlier detection

The agent follows an analytical reasoning process: explore first, assess data quality, refine queries, validate results, explain transparently.

A second **formatter agent** polishes the output and generates chart specs (bar, line, pie, horizontal bar) when the data is visualizable.

### LLM Providers

Configure in the app UI. Supported providers:

| Provider | Default Model |
|----------|--------------|
| OpenAI | gpt-4o |
| Anthropic | claude-sonnet-4-20250514 |
| Google | gemini-2.0-flash |

API keys are stored in memory only — never written to disk. After a backend restart, you'll need to re-enter your key (the "LLM Config" button in the header lets you do this at any time).

---

## Data Persistence

| What | Where | Survives restart? |
|------|-------|-------------------|
| DuckDB database | `data/warehouse.duckdb` | Yes (volume mount) |
| Pipeline state | `data/pipeline_state.json` | Yes (volume mount) |
| dbt project | `data/dbt_project/` | Yes (volume mount) |
| LLM API key | Backend memory | No — re-enter after restart |
| ML path sessions | `/tmp/app_sessions/` | No — ephemeral by design |

In Docker, `data/` maps to wherever you mount the volume (`-v ./myproject:/app/data`). In local dev, it defaults to `backend/data/`.

---

## API Reference

### Analytics Pipeline

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/analytics/configure` | Set LLM provider + API key |
| `POST` | `/api/analytics/upload` | Upload CSV files into DuckDB |
| `POST` | `/api/analytics/generate-sources` | Generate dbt sources.yml |
| `POST` | `/api/analytics/generate-staging` | Generate staging models + run dbt |
| `POST` | `/api/analytics/generate-semantic` | Generate semantic layer |
| `POST` | `/api/analytics/chat` | Send message to chat agent |
| `GET` | `/api/analytics/state` | Get full pipeline state |
| `GET` | `/api/analytics/tables` | List DuckDB tables with schemas |
| `GET` | `/api/analytics/providers` | List supported LLM providers |
| `GET` | `/api/analytics/system-prompt` | View the agent's system prompt |
| `GET` | `/api/analytics/artifacts/{type}` | Get dbt artifacts (sources/staging/semantic) |
| `POST` | `/api/analytics/reset` | Reset everything (drop tables, clear state) |

### ML Model Prep

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/upload` | Upload and profile a CSV |
| `GET` | `/api/data/schema` | Get column schema |
| `GET` | `/api/data/preview` | Preview data (head/tail/sample) |
| `POST` | `/api/transform/suggest` | AI-suggested transformations |
| `POST` | `/api/transform/apply` | Apply renames, casts, imputations |
| `GET` | `/api/profile/column` | Detailed column profiling |
| `GET` | `/api/profile/global` | Duplicates + correlation matrix |
| `GET` | `/api/analyze/relationship` | Two-column relationship analysis |

---

## Common Issues

**"API key not configured" after restart**
Expected behavior — keys are in-memory only. Click "LLM Config" in the header to re-enter.

**Docker creates a new container every time**
Use `--name` and then `docker start`/`stop` instead of `docker run` each time. See the Docker section above.

**Port 8000 already in use**
```bash
docker stop mydatapartner   # if it's a leftover container
# or
lsof -i :8000               # find what's using the port
```

**Frontend can't reach backend (local dev)**
Make sure the backend is running on port 8001. The Next.js proxy in `next.config.ts` forwards `/api/*` to `localhost:8001`.
