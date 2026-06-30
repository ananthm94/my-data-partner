# Stage 1: Build Next.js frontend
FROM node:22-alpine AS frontend-build
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ .
RUN npm run build

# Stage 2: Python runtime with everything
FROM python:3.12-slim

RUN apt-get update && \
    apt-get install -y --no-install-recommends nginx supervisor curl && \
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && \
    apt-get install -y --no-install-recommends nodejs && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Python dependencies
COPY backend/requirements-api.txt .
RUN pip install --no-cache-dir -r requirements-api.txt

# Backend
COPY backend/ ./backend/

# Frontend (standalone build)
COPY --from=frontend-build /app/frontend/.next/standalone ./frontend/
COPY --from=frontend-build /app/frontend/.next/static ./frontend/.next/static
COPY --from=frontend-build /app/frontend/public ./frontend/public

# Config files
COPY nginx.conf ./nginx.conf
COPY supervisord.conf ./supervisord.conf
COPY start.sh ./start.sh
RUN chmod +x /app/start.sh

# Data directory (mount a volume here for persistence)
RUN mkdir -p /app/data
ENV DATA_DIR=/app/data

EXPOSE 8000

CMD ["/app/start.sh"]
