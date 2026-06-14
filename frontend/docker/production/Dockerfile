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
    && rm -rf /var/lib/apt/lists/*

# Install pnpm globally
RUN npm install -g pnpm@9

# Copy package.json and ./pnpm-lock.yaml to the container
COPY ./package.json .
COPY ./pnpm-lock.yaml .

# Install Node.js dependencies
RUN pnpm install

# Copy the rest of the application source code to the container
COPY ./src ./src
COPY ./public ./public

# Copy config files to the container
COPY ./tsconfig.json .
COPY ./vite.config.ts .
COPY ./index.html .
COPY ./.env.testing .env

ENV VITE_HARVEY_URL=https://sphere.score.us.es/harvey-api

# Build your application
RUN pnpm run build
RUN pnpm add -D serve

CMD ["pnpm", "exec", "serve", "-s", "./dist", "-l", "5173"]