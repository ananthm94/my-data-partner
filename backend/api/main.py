from __future__ import annotations

import os
from contextlib import asynccontextmanager
from pathlib import Path

# Load .env from the project root if present (optional — env vars always take precedence)
try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).parent.parent / ".env")
except ImportError:
    pass

from apscheduler.schedulers.background import BackgroundScheduler
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.routers import analyze, clean, custom, join, profile, transform, upload, workspace
from api.services.session import cleanup_old_sessions


@asynccontextmanager
async def lifespan(app: FastAPI):
    scheduler = BackgroundScheduler()
    scheduler.add_job(cleanup_old_sessions, "interval", minutes=30)
    scheduler.start()
    yield
    scheduler.shutdown()


app = FastAPI(title="myDataPartner API", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

API_PREFIX = "/api"
for router_module in (upload, transform, profile, analyze, join, custom, clean, workspace):
    app.include_router(router_module.router, prefix=API_PREFIX)
