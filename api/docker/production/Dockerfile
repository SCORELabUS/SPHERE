# Use an official Node.js runtime as the base image
FROM node:21.1-slim

ENV http_proxy=http://proxy.int.local:3128
ENV https_proxy=http://proxy.int.local:3128
ENV no_proxy=localhost,127.0.0.1

# Install minizinc
RUN apt-get update && apt-get install -y minizinc && apt-get clean

# Set the working directory in the container
WORKDIR /usr/src/server

# Install pnpm globally
RUN npm install -g pnpm@9

# Copy package.json and ./pnpm-lock.yaml to the container
COPY ./package.json .
COPY ./pnpm-lock.yaml .

# Install Node.js dependencies
RUN pnpm install 

# Copy the rest of the application source code to the container
COPY ./src/main ./src/main

# Copy tsconfig.json to the container
COPY ./tsconfig.json .

# Copy migration script to the container
COPY ./scripts/migrate.sh ./scripts/migrate.sh

# Build your application
RUN pnpm run build

COPY ./docker/entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh

# Specify the command to start the server
CMD [ "./entrypoint.sh" ]