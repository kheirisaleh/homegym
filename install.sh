#!/usr/bin/env bash
set -euo pipefail

TARGET_DIR="${TARGET_DIR:-$HOME/workout-tracker}"
SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT=8090

if command -v ss > /dev/null && ss -tln | awk '{print $4}' | grep -qE "[:.]${PORT}\$"; then
  if ! docker ps --format '{{.Names}}' | grep -qx workout-tracker; then
    echo "Port ${PORT} is already used by something else. Change it in docker-compose.yml first."
    exit 1
  fi
fi

if [ "$SOURCE_DIR" != "$TARGET_DIR" ]; then
  mkdir -p "$TARGET_DIR"
  cp -r "$SOURCE_DIR/app" "$SOURCE_DIR/docs" "$SOURCE_DIR/Dockerfile" "$SOURCE_DIR/.dockerignore" "$SOURCE_DIR/docker-compose.yml" "$SOURCE_DIR/requirements.txt" "$SOURCE_DIR/README.md" "$TARGET_DIR/"
  rm -rf "$TARGET_DIR/frontend"
  tar -C "$SOURCE_DIR" --exclude=node_modules --exclude=test-results --exclude=playwright-report -cf - frontend | tar -C "$TARGET_DIR" -xf -
fi

mkdir -p "$TARGET_DIR/data"
if [ ! -f "$TARGET_DIR/.env" ]; then echo "Missing $TARGET_DIR/.env with GEMINI_API_KEY=..."; exit 1; fi
cd "$TARGET_DIR"
docker compose up -d --build

for attempt in $(seq 1 30); do
  if curl -fs "http://127.0.0.1:${PORT}/healthz" > /dev/null; then
    echo "Workout tracker is running on port ${PORT}."
    exit 0
  fi
  sleep 2
done

echo "The container did not answer in time. Check: docker logs workout-tracker"
exit 1
