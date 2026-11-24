<div align="center">

# SPHERE

**SaaS Pricing Holistic Evaluation and Regulation Environment**

A collaborative platform to model, version, analyze and govern SaaS pricings.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Release](https://img.shields.io/github/v/release/SCORELabUS/SPHERE?sort=semver)](https://github.com/SCORELabUS/SPHERE/releases)
[![Tests](https://github.com/SCORELabUS/SPHERE/actions/workflows/run-unit-tests.yml/badge.svg?branch=main&event=push)](https://github.com/SCORELabUS/SPHERE/actions/workflows/run-unit-tests.yml)

[Live instance](https://sphere.score.us.es/) · [API reference](api/docs/sphere-api-docs.yaml) · [Report an issue](https://github.com/SCORELabUS/SPHERE/issues)

</div>

---

## Table of contents

- [Overview](#overview)
- [Features](#features)
- [Architecture](#architecture)
- [Quick start with Docker](#quick-start-with-docker)
- [Published container images](#published-container-images)
- [AI services](#ai-services)
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
| AI services (HARVEY, A-MINT, analysis engines, pricing MCP server) | Python, Node.js, Java | [Pricing Intelligence repository](https://github.com/SCORELabUS/Pricing-Intelligence-Interpretation-Process), see [AI services](#ai-services) |

The API serves under `/api/v1` and also exposes the pricing files under `/static`. In production, nginx routes both paths to the API and everything else to the web client.

## Quick start with Docker

**Requirements:** [Docker](https://docs.docker.com/get-docker/) with Docker Compose 2.30 or later.

```bash
git clone https://github.com/SCORELabUS/SPHERE.git
cd SPHERE
```

Start the stack:

```bash
cd docker/testing
docker compose up -d
```

SPHERE is then available at [http://localhost](http://localhost). The web client shows the changelog committed in the repository; the production build refreshes it from GitHub with a token in `docker/gh_pat.txt` (see [`docs/RELEASING.md`](docs/RELEASING.md)). The stack runs MongoDB, Redis, the API, the web client and nginx, configured with [`api/.env.testing`](api/.env.testing) and [`frontend/.env.testing`](frontend/.env.testing).

> [!WARNING]
> The `testing` configuration ships with default credentials and secrets. Change them before exposing the instance to a network.

## Published container images

Every release publishes two multi-architecture (`amd64`/`arm64`) images to the GitHub Container Registry. Tags match the release version without the leading `v` (release `v2.9.1` → tag `2.9.1`), and `latest` points to the newest stable release.

```bash
docker pull ghcr.io/scorelabus/sphere-api:latest     # Express API with MiniZinc, port 8080
docker pull ghcr.io/scorelabus/sphere-client:latest  # Static web client served by nginx, port 80
```

These images still need MongoDB, Redis and a reverse proxy that routes `/api/v1` and `/static` to the API and everything else to the client. Use [`docker/testing/docker-compose.yml`](docker/testing/docker-compose.yml) and [`nginx/`](nginx) as a reference. The API reads the same environment variables as [`api/.env.testing`](api/.env.testing); the client is built with `VITE_API_URL=/api/v1`.

## AI services

HARVEY and the services it relies on are developed in a separate repository, [SCORELabUS/Pricing-Intelligence-Interpretation-Process](https://github.com/SCORELabUS/Pricing-Intelligence-Interpretation-Process), released under the MIT License. Each of its releases publishes the images to GHCR, and SPHERE pins them by version and digest in [`docker/production`](docker/production/docker-compose.yml), [`docker/pre-production`](docker/pre-production/docker-compose.yml) and [`docker/testing/docker-compose.ai.yml`](docker/testing/docker-compose.ai.yml).

| Service | Role | Image | Source |
| --- | --- | --- | --- |
| HARVEY | Conversational assistant about pricings | `ghcr.io/scorelabus/harvey` | [`harvey_api/`](https://github.com/SCORELabUS/Pricing-Intelligence-Interpretation-Process/tree/main/harvey_api) |
| A-MINT | Extracts Pricing2Yaml models from pricing web pages | `ghcr.io/scorelabus/a-mint` | [`src/`](https://github.com/SCORELabUS/Pricing-Intelligence-Interpretation-Process/tree/main/src) |
| Analysis engine | Pricing analysis used by HARVEY | `ghcr.io/scorelabus/pricing-analysis-engine` | [`analysis_api/`](https://github.com/SCORELabUS/Pricing-Intelligence-Interpretation-Process/tree/main/analysis_api) |
| CSP engine | Choco constraint solver behind the analysis engine | `ghcr.io/scorelabus/choco-pricing-analysis-engine` | [`csp/`](https://github.com/SCORELabUS/Pricing-Intelligence-Interpretation-Process/tree/main/csp) |
| Pricing MCP server | Tools that HARVEY calls | `ghcr.io/scorelabus/pi-mcp-server` | [`mcp_server/`](https://github.com/SCORELabUS/Pricing-Intelligence-Interpretation-Process/tree/main/mcp_server) |

ORBIT is part of the SPHERE API and is not one of these services.

To add them to the [quick-start stack](#quick-start-with-docker), put an OpenAI key in `docker/testing/.env` and start both Compose files:

```bash
cd docker/testing
echo "OPENAI_API_KEY=sk-..." > .env
docker compose -f docker-compose.yml -f docker-compose.ai.yml up -d
```

The same key enables ORBIT's chat. The images are built for `linux/amd64`; on Apple Silicon, Docker runs them under emulation. To move to a new release of the AI services, run `scripts/pin-ai-images.sh <version>`, which resolves the digests and updates the three Compose files.

### What works without them

Neither the AI services nor an OpenAI key are needed for the rest of SPHERE:

| Feature | Without AI services or OpenAI key |
| --- | --- |
| Pricing editor, versioning, collections, organizations and permissions | Available |
| Analytics (configuration space and optimization, computed with MiniZinc in the API) | Available: open a pricing with several versions and go to its Analytics tab |
| REST API and permanent links | Available |
| ORBIT's MCP server (`/api/v1/orbit/mcp`) | Available: it calls no language model. Connect your own assistant with an API key (user menu → API Keys) or through OAuth, managed in Settings → Connected applications |
| ORBIT's chat in the web client | Needs an OpenAI key (`ORBIT_OPENAI_API_KEY`); without one it reports that it is unavailable |
| HARVEY's chat | Needs the AI services and an OpenAI key |
| Extraction of pricings from web pages (A-MINT) | Needs the AI services and an OpenAI key |

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

## SCORETech Identity

SPHERE can switch between its current sign-in and centralized SCORETech Identity
using `AUTH_PROVIDER=local|scoretech` (API environment during development, shared
API/gateway switch in `docker/production/.env` for Docker). See
[configuration, account linking and rollback](docs/scoretech-identity.md) and the
sanitized [API environment example](api/.env.scoretech.example). The frontend reads
the selected mode at runtime and adapts authentication and Settings accordingly.
