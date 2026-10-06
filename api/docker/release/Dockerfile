# syntax=docker/dockerfile:1.7
# Public release image of the SPHERE API (published to GHCR by .github/workflows/publish-image.yml).
# Unlike docker/production, it has no proxy settings, so it builds anywhere.

# ---- Build stage: install dependencies and compile TypeScript ----
FROM node:21.1-slim AS build
WORKDIR /usr/src/server

RUN npm install -g pnpm@9

COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,id=sphere-api-pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

COPY tsconfig.json ./
COPY src/main ./src/main
RUN pnpm run build

# ---- Runtime stage ----
FROM node:21.1-slim
WORKDIR /usr/src/server

# MiniZinc (gecode solver included) is required by the analytics/pricing optimization.
RUN apt-get update \
    && apt-get install -y --no-install-recommends minizinc \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production

# node_modules keeps the dev dependencies on purpose: the entrypoint runs the TypeScript
# migrations with ts-migrate-mongoose.
COPY --from=build /usr/src/server/node_modules ./node_modules
COPY --from=build /usr/src/server/dist ./dist
COPY package.json tsconfig.json ./
# The TypeScript migrations import models and utils from the whole src/main tree.
COPY src/main ./src/main
COPY scripts/migrate.sh ./scripts/migrate.sh
COPY public/static/avatars ./public/static/avatars
COPY docker/entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh

EXPOSE 8080
CMD ["./entrypoint.sh"]
