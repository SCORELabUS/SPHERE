#!/bin/sh
# Prepares the testing stack with demo data before the API starts (see
# docker-compose.yml): copies the example pricing files to the statics volume
# and seeds an empty database. Then the image's own entrypoint runs the
# migrations and starts the API.
set -e
cd /usr/src/server

if [ ! -d public/static/pricings/originalDataset ]; then
  echo "Demo data: copying example pricing files..."
  mkdir -p public/static/pricings
  cp -r demo/originalDataset public/static/pricings/originalDataset
fi

echo "Demo data: waiting for MongoDB at ${MONGO_HOST}:${MONGO_PORT:-27017}..."
until node -e "
const s = new (require('net').Socket)();
s.setTimeout(1000);
s.on('connect', () => { s.destroy(); process.exit(0); });
s.on('error', () => process.exit(1));
s.on('timeout', () => process.exit(1));
s.connect(${MONGO_PORT:-27017}, '${MONGO_HOST}');
"; do
  sleep 1
done

npx tsx --tsconfig tsconfig.json scripts/seed-demo.ts
