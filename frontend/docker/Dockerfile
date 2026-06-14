# Use an official Node.js runtime as the base image
FROM node:21.1-slim

# Set the working directory in the container
WORKDIR /usr/src/client

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

# Build your application
RUN pnpm run build
RUN pnpm add -D serve

# Specify the command to start the server
CMD ["pnpm", "exec", "serve", "-s", "./dist", "-l", "5173"]
