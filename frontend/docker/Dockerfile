# syntax=docker/dockerfile:1
# Use an official Node.js runtime as the base image
FROM node:22-slim

# gh needs ca-certificates to work
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates gh \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Set the working directory in the container
WORKDIR /usr/src/client

# Install pnpm globally
RUN npm install -g pnpm@9

# Copy package.json and pnpm-lock.yaml to the container
COPY package.json pnpm-lock.yaml .

# Install Node.js dependencies
RUN pnpm install 

# Copy the rest of the application source code to the container
COPY ./scripts ./scripts
COPY ./src ./src
COPY ./public ./public

# Copy config files to the container
COPY tsconfig.json vite.config.ts index.html .
COPY .env.testing .env

# The changelog is refreshed from GitHub only when a token is given (the
# gh_token build secret). Without one, the build keeps the changelog committed
# in src/modules/presentation/pages/changelog/data.
RUN --mount=type=secret,id=gh_token,required=false \
if [ -s /run/secrets/gh_token ]; then \
  GH_TOKEN=$(cat /run/secrets/gh_token) node ./scripts/generate-changelog.js pricing-int \
  && GH_TOKEN=$(cat /run/secrets/gh_token) node ./scripts/generate-changelog.js sphere; \
else \
  echo "No gh_token secret: using the committed changelog"; \
fi

# Build your application
RUN pnpm run build
RUN pnpm add -D serve

# Specify the command to start the server
CMD ["pnpm", "exec", "serve", "-s", "./dist", "-l", "5173"]
