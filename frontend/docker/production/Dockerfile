# Node 21 ya no tiene soporte y causa conflictos.
FROM node:22-slim

# 2. Definimos las variables de entorno del proxy (Mayúsculas y minúsculas)
# Es buena práctica poner ambas para asegurar compatibilidad con todas las herramientas.
ENV http_proxy=http://proxy.int.local:3128
ENV https_proxy=http://proxy.int.local:3128
ENV HTTP_PROXY=http://proxy.int.local:3128
ENV HTTPS_PROXY=http://proxy.int.local:3128

WORKDIR /usr/src/client

# 3. Instalamos libvips a nivel de sistema operativo
# Esto es CRUCIAL. Al instalar esto, 'sharp' detectará que ya existe
# y NO intentará descargar el binario que está fallando en tu proxy.
RUN apt-get update && apt-get install -y \
    libvips-dev \
    python3 \
    make \
    g++ \
    gh \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

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
COPY ./.env.testing .env

ENV VITE_HARVEY_URL=https://sphere.score.us.es/harvey-api

RUN --mount=type=secret,id=gh_token,required \
GH_TOKEN=$(cat /run/secrets/gh_token) node ./scripts/generate-changelog.js pricing-int \
&& GH_TOKEN=$(cat /run/secrets/gh_token) node ./scripts/generate-changelog.js sphere

# Build your application
RUN pnpm run build
RUN pnpm add -D serve

CMD ["pnpm", "exec", "serve", "-s", "./dist", "-l", "5173"]