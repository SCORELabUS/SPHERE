<div align="center">

# SPHERE

**SaaS Pricing Holistic Evaluation and Regulation Environment**

A collaborative platform to model, version, analyze and govern SaaS pricings.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Release](https://img.shields.io/github/v/release/SCORELabUS/SPHERE?sort=semver)](https://github.com/SCORELabUS/SPHERE/releases)
[![Tests](https://github.com/SCORELabUS/SPHERE/actions/workflows/run-unit-tests.yml/badge.svg)](https://github.com/SCORELabUS/SPHERE/actions/workflows/run-unit-tests.yml)

[Live instance](https://sphere.score.us.es/) · [API reference](api/docs/sphere-api-docs.yaml) · [Report an issue](https://github.com/SCORELabUS/SPHERE/issues)

</div>

---

## Table of contents

- [Overview](#overview)
- [Features](#features)
- [Architecture](#architecture)
- [Quick start with Docker](#quick-start-with-docker)
- [Published container images](#published-container-images)
- [Local development](#local-development)
- [Testing](#testing)
- [Documentation](#documentation)
- [Contributing](#contributing)
- [License](#license)
- [Acknowledgements](#acknowledgements)

## Overview

SPHERE brings together the applications, datasets and tools for pricing-driven development in a single environment. Pricings are described in the Pricing2Yaml format and stored as versioned families that organizations can share, analyze and evolve over time.

A public instance is available at **[sphere.score.us.es](https://sphere.score.us.es/)**. To keep your data on your own infrastructure or to try unreleased features, you can deploy your own instance as described below.

## Features

- **Pricing repository.** Upload, edit and version pricings, compare versions, keep versions private and group pricings in collections.
- **Analytics.** Configuration-space and optimization analyses of each pricing, computed with [MiniZinc](https://www.minizinc.org/).
- **Organizations and permissions.** Nested organizations, roles, invitations and fine-grained permissions on pricings and collections.
- **Permanent links and synchronization.** Stable URLs for pricings and collections that survive renaming and moving, and a public API for synchronization with [SPACE](docs/permanent-links.md).
- **AI assistants.** HARVEY answers questions about pricings; ORBIT reads the workspace and proposes changes as plans that the user confirms before they are applied.
- **MCP server.** ORBIT's tools are exposed at `/api/v1/orbit/mcp`, so assistants such as Claude or ChatGPT can work with SPHERE through API keys or OAuth. See the [SPHERE ORBIT plugin](https://github.com/SCORELabUS/sphere-orbit-plugin).
- **REST API.** Every feature is available through a documented, rate-limited API with API keys.

## Architecture

| Component | Technology | Location |
| --- | --- | --- |
| Web client | React, Vite, Tailwind CSS v4 | [`frontend/`](frontend) |
| API | Node.js, Express, TypeScript | [`api/`](api) |
| Database | MongoDB 7 | — |
| Cache, rate limiting, OAuth state | Redis 7 | — |
| Analytics solver | MiniZinc with Gecode | bundled in the API image |
| Reverse proxy | nginx | [`nginx/`](nginx) |

The API serves under `/api/v1` and also exposes the pricing files under `/static`. In production, nginx routes both paths to the API and everything else to the web client.

## Quick start with Docker

**Requirements:** [Docker](https://docs.docker.com/get-docker/) with Docker Compose v2.

```bash
git clone https://github.com/SCORELabUS/SPHERE.git
cd SPHERE
```

The web client image generates its changelog from GitHub at build time, so the build needs a GitHub personal access token with read access to public repositories. Save it in `docker/gh_pat.txt` (it is ignored by Git):

```bash
echo "<your-github-token>" > docker/gh_pat.txt
```

Then start the stack:

```bash
cd docker/testing
docker compose up -d
```

SPHERE is then available at [http://localhost](http://localhost). The stack runs MongoDB, Redis, the API, the web client and nginx, configured with [`api/.env.testing`](api/.env.testing) and [`frontend/.env.testing`](frontend/.env.testing).

> [!WARNING]
> The `testing` configuration ships with default credentials and secrets. Change them before exposing the instance to a network.

## Published container images

Every release publishes two multi-architecture (`amd64`/`arm64`) images to the GitHub Container Registry. Tags match the release version without the leading `v` (release `v2.9.1` → tag `2.9.1`), and `latest` points to the newest stable release.

```bash
docker pull ghcr.io/scorelabus/sphere-api:latest     # Express API with MiniZinc, port 8080
docker pull ghcr.io/scorelabus/sphere-client:latest  # Static web client served by nginx, port 80
```

These images still need MongoDB, Redis and a reverse proxy that routes `/api/v1` and `/static` to the API and everything else to the client. Use [`docker/testing/docker-compose.yml`](docker/testing/docker-compose.yml) and [`nginx/`](nginx) as a reference. The API reads the same environment variables as [`api/.env.testing`](api/.env.testing); the client is built with `VITE_API_URL=/api/v1`.

## Local development

### Prerequisites

- [Node.js](https://nodejs.org/) 22 or later
- [pnpm](https://pnpm.io/installation), the project's package manager
- [Docker](https://docs.docker.com/get-docker/), to run MongoDB and Redis locally
- [MiniZinc](https://www.minizinc.org/doc-latest/en/installation.html) with the Gecode solver, used by the pricing analytics. Check that `minizinc --solvers` lists `gecode`.

### Setup

1. **Clone the repository and install dependencies** for both packages:

   ```bash
   git clone https://github.com/SCORELabUS/SPHERE.git
   cd SPHERE
   pnpm run install
   ```

2. **Configure the environment.** Create `api/.env` from [`api/.env.testing`](api/.env.testing), pointing `MONGO_HOST` to `localhost` and `REDIS_URL` to `redis://localhost:6378`. Create `frontend/.env` from [`frontend/.env.example`](frontend/.env.example).

3. **Start MongoDB and Redis and seed the database:**

   ```bash
   pnpm run dev:setup
   ```

4. **Run the API and the web client:**

   ```bash
   pnpm run dev
   ```

   The API applies pending migrations on startup and listens on [http://localhost:8080](http://localhost:8080); the web client runs on [http://localhost:5173](http://localhost:5173). Set `VITE_API_PROXY_TARGET` if the API runs on a different port.

### Useful commands

| Command | Description |
| --- | --- |
| `pnpm run dev` | Run the API and the Vite dev server concurrently |
| `pnpm run dev:setup` | Start MongoDB and Redis and seed the database |
| `pnpm run build` | Build the web client and the API |
| `pnpm run test` | Run the API test suite and reseed the database |
| `pnpm run test:frontend` | Run the web client tests |
| `pnpm run lint` | Lint the repository |
| `pnpm run seed:mongo-local:small` | Reset and reseed the local database |

## Testing

The API suite uses [Vitest](https://vitest.dev/) and runs against a real MongoDB and Redis. Tests run sequentially, and the suite reseeds the database when it finishes.

```bash
pnpm run test
```

To run a subset of tests:

```bash
cd api
npx vitest --run --test-name-pattern "<pattern>"
```

> [!CAUTION]
> The integration and end-to-end harnesses drop the database they use. Run them only against a dedicated test database, never against data you want to keep.

## Documentation

| Document | Content |
| --- | --- |
| [`api/docs/sphere-api-docs.yaml`](api/docs/sphere-api-docs.yaml) | OpenAPI specification of the REST API |
| [`docs/permanent-links.md`](docs/permanent-links.md) | Permanent links, public synchronization API and SPACE integration |
| [`api/docs/database-seeders.md`](api/docs/database-seeders.md) | Database seeders |
| [`docs/CONTRIBUTING.md`](docs/CONTRIBUTING.md) | Contribution guidelines and commit conventions |
| [`docs/RELEASING.md`](docs/RELEASING.md) | Release process |
| [`AGENTS.md`](AGENTS.md) | Detailed notes on the codebase for contributors and coding agents |

## Contributing

Contributions are welcome. Please read the [contribution guidelines](docs/CONTRIBUTING.md) before opening a pull request. Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/) and are checked by commitlint on every commit.

Bugs and feature requests can be reported through [GitHub Issues](https://github.com/SCORELabUS/SPHERE/issues).

## License

SPHERE is released under the [MIT License](LICENSE).

The software is provided "as is", without warranty of any kind. SPHERE is a research prototype under active development; evaluate it carefully before relying on it in production.

## Acknowledgements

SPHERE is developed by the [SCORE Lab](https://github.com/SCORELabUS) within the research activities of the [ISA Group](https://www.isa.us.es/3.0/) at the University of Seville.
