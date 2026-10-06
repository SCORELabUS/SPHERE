# syntax=docker/dockerfile:1.7
# Public release image of the SPHERE frontend (published to GHCR by .github/workflows/publish-image.yml).
# Unlike docker/production, it has no proxy settings, so it builds anywhere.

# ---- Build stage ----
FROM node:22-slim AS build
WORKDIR /usr/src/client

# gh is used by scripts/generate-changelog.js
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates gh \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

RUN npm install -g pnpm@9

COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,id=sphere-client-pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

COPY scripts ./scripts
COPY src ./src
COPY public ./public
COPY tsconfig.json vite.config.ts index.html ./

# Vite inlines these values at build time. Override them with --build-arg if needed.
ARG VITE_API_URL=/api/v1
ARG VITE_SECRET_KEY=sphere-client-secret
ARG VITE_HARVEY_URL=/harvey-api
ARG VITE_SPHERE_HOST=localhost
ENV VITE_API_URL=$VITE_API_URL \
    VITE_SECRET_KEY=$VITE_SECRET_KEY \
    VITE_HARVEY_URL=$VITE_HARVEY_URL \
    VITE_SPHERE_HOST=$VITE_SPHERE_HOST

# Embeds the releases changelog. The gh_token secret is optional: without it the step is skipped
# and the changelog pages are built with whatever is committed in the repository.
RUN --mount=type=secret,id=gh_token \
    if [ -s /run/secrets/gh_token ]; then \
        export GH_TOKEN="$(cat /run/secrets/gh_token)" \
        && node ./scripts/generate-changelog.js pricing-int \
        && node ./scripts/generate-changelog.js sphere; \
    else \
        echo "gh_token secret not provided, skipping changelog generation"; \
    fi

RUN pnpm run build

# ---- Runtime stage: static assets only ----
FROM nginx:1.27.3-alpine
COPY docker/release/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /usr/src/client/dist /usr/share/nginx/html
EXPOSE 80
