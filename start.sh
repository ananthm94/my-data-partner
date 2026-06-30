#!/bin/sh
# Replace the port placeholder with Render's PORT env var (default 8000 for local Docker)
sed -i "s/PORT_PLACEHOLDER/${PORT:-8000}/g" /app/nginx.conf
exec supervisord -c /app/supervisord.conf
