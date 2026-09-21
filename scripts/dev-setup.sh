#!/usr/bin/env bash
set -euo pipefail

# SPHERE and SPACE deliberately share one local MongoDB and Redis instance.
# Start the containers only when those host ports are not already provided by
# the other project (or by a developer's existing local installation).
if ! nc -z 127.0.0.1 27017 2>/dev/null || ! nc -z 127.0.0.1 6378 2>/dev/null; then
  (cd docker/dev && docker compose up -d)
fi

echo "Waiting for shared MongoDB and Redis..."
for i in {1..30}; do
  if nc -z 127.0.0.1 27017 2>/dev/null && nc -z 127.0.0.1 6378 2>/dev/null; then
    break
  fi
  sleep 1
done

if ! nc -z 127.0.0.1 27017 2>/dev/null || ! nc -z 127.0.0.1 6378 2>/dev/null; then
  echo "MongoDB/Redis are not reachable on localhost (27017/6378)." >&2
  exit 1
fi

pnpm run seed:mongo-local:small
