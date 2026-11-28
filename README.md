<div align="center">

# SPHERE

**SaaS Pricing Holistic Evaluation and Regulation Environment**

Model, version, analyze and govern SaaS pricings, together.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Release](https://img.shields.io/github/v/release/SCORELabUS/SPHERE?sort=semver)](https://github.com/SCORELabUS/SPHERE/releases)
[![Tests](https://github.com/SCORELabUS/SPHERE/actions/workflows/run-unit-tests.yml/badge.svg?branch=main&event=push)](https://github.com/SCORELabUS/SPHERE/actions/workflows/run-unit-tests.yml)
[![Docs](https://img.shields.io/badge/docs-sphere--docs-orange.svg)](https://sphere-docs.vercel.app/docs/2.0.1/api/sphere/introduction)

[**Live instance**](https://sphere.score.us.es) · [Documentation](https://sphere-docs.vercel.app/docs/2.0.1/api/sphere/introduction) · [Self-hosting](https://sphere-docs.vercel.app/docs/2.0.1/api/sphere/self-hosting) · [API reference](api/docs/sphere-api-docs.yaml) · [Report an issue](https://github.com/SCORELabUS/SPHERE/issues)

<img src="docs/images/readme-pricing.webp" alt="The Slack pricing in SPHERE: its plans, number of configurations, price range and versions" width="900">

</div>

## About

SaaS pricings change constantly: plans, add-ons, features and usage limits combine into thousands of possible subscriptions, and providers revise them every year. SPHERE treats a pricing as an engineering artifact. Each pricing is written in the [Pricing2Yaml](https://sphere-docs.vercel.app/docs/2.0.1/api/pricing-description-languages/Pricing2Yaml/the-pricing2yaml-syntax) format, kept as a history of versions, analyzed automatically and shared within organizations, with an API and AI assistants on top.

A public instance runs at **[sphere.score.us.es](https://sphere.score.us.es)**. You can also [run your own](#run-your-own-instance).

## Features

- 📚 **Pricing repository.** Upload, edit and version pricings, compare versions, keep some private and group pricings into collections.
- 📈 **Analytics.** The number of possible subscriptions and the price range of each pricing, how they evolve across versions, and the cheapest subscription for given needs, computed with [MiniZinc](https://www.minizinc.org/).
- 🏢 **Organizations and permissions.** Nested organizations, roles, invitations and fine-grained permissions on pricings and collections.
- 🔗 **Permanent and anonymous links.** Stable URLs that survive renames and moves, and links that share a pricing with people who have no account.
- 🤖 **AI assistants.** HARVEY answers questions about pricings; ORBIT reads your workspace and proposes changes as plans you confirm. Both work with OpenAI or a [self-hosted model](https://sphere-docs.vercel.app/docs/2.0.1/api/sphere/self-hosting/ai-assistants).
- 🔌 **REST API and MCP server.** Everything is available through a documented API with API keys, and assistants such as Claude or ChatGPT can use ORBIT's tools through the [SPHERE ORBIT plugin](https://github.com/SCORELabUS/sphere-orbit-plugin).

<table>
  <tr>
    <td width="50%"><img src="docs/images/readme-analytics.webp" alt="Analytics tab: minimum and maximum price and number of configurations across Slack's versions"></td>
    <td width="50%"><img src="docs/images/readme-versions.webp" alt="Versions tab: version graph of the Slack pricing and its list of versions"></td>
  </tr>
  <tr>
    <td align="center"><sub>How a pricing evolves across its versions</sub></td>
    <td align="center"><sub>Version graph and history</sub></td>
  </tr>
</table>

## Quick start

Try SPHERE on your machine with demo accounts and 32 example pricings. You need [Docker](https://docs.docker.com/get-docker/) with Docker Compose 2.30 or later.

```bash
git clone https://github.com/SCORELabUS/SPHERE.git
cd SPHERE/docker/testing
docker compose up -d
```

Open <http://localhost> and sign in as `sphere` with the password `faked`. The first start takes a few minutes while it builds the images and loads the data.

The demo runs without the AI services; [AI services](#ai-services) explains how to add them. The [local demo guide](https://sphere-docs.vercel.app/docs/2.0.1/api/sphere/self-hosting/run-locally) lists the other demo accounts and what to try.

> [!WARNING]
> The demo stack ships with default passwords and secrets. Keep it on your own machine.

## Run your own instance

[`docker/self-hosted`](docker/self-hosted) runs SPHERE on your server from the published images: copy `.env.example` to `.env`, set your address and three secrets, and start it with `docker compose up -d`.

| Guide | Covers |
| --- | --- |
| [Deploy your own instance](https://sphere-docs.vercel.app/docs/2.0.1/api/sphere/self-hosting/deploy-your-own-instance) | Configuration, HTTPS, the first account, updates and backups |
| [Enable the AI assistants](https://sphere-docs.vercel.app/docs/2.0.1/api/sphere/self-hosting/ai-assistants) | HARVEY, ORBIT and A-MINT with OpenAI or a self-hosted, OpenAI-compatible model |
| [Configuration reference](https://sphere-docs.vercel.app/docs/2.0.1/api/sphere/self-hosting/configuration-reference) | Every variable of the `.env` file |

Each release publishes the `ghcr.io/scorelabus/sphere-api` and `ghcr.io/scorelabus/sphere-client` images for `amd64` and `arm64`, tagged with the version (such as `2.14.0`) and `latest`. The kit runs the version of the release it comes with; set `SPHERE_VERSION` to choose another.

## AI services

HARVEY and the services it relies on are developed in a separate repository, [Pricing Intelligence Interpretation Process (PIIP)](https://github.com/SCORELabUS/Pricing-Intelligence-Interpretation-Process), released under the [MIT License](https://github.com/SCORELabUS/Pricing-Intelligence-Interpretation-Process/blob/main/LICENSE). Each PIIP release publishes their images to the GitHub Container Registry, and each SPHERE release pins them by version and digest in its Compose files, so it always runs the same build. This release uses [PIIP 1.3.0](https://github.com/SCORELabUS/Pricing-Intelligence-Interpretation-Process/releases/tag/v1.3.0).

| Service | Role | Image | Source |
| --- | --- | --- | --- |
| HARVEY | Assistant that answers questions about pricings | `ghcr.io/scorelabus/harvey:1.3.0` | [`harvey_api/`](https://github.com/SCORELabUS/Pricing-Intelligence-Interpretation-Process/tree/v1.3.0/harvey_api) |
| A-MINT | Extracts Pricing2Yaml models from pricing web pages | `ghcr.io/scorelabus/a-mint:1.3.0` | [`src/`](https://github.com/SCORELabUS/Pricing-Intelligence-Interpretation-Process/tree/v1.3.0/src) |
| Analysis engine (PRIME) | Pricing analysis used by HARVEY | `ghcr.io/scorelabus/pricing-analysis-engine:1.3.0` | [`analysis_api/`](https://github.com/SCORELabUS/Pricing-Intelligence-Interpretation-Process/tree/v1.3.0/analysis_api) |
| CSP engine | Choco constraint solver behind the analysis engine | `ghcr.io/scorelabus/choco-pricing-analysis-engine:1.3.0` | [`csp/`](https://github.com/SCORELabUS/Pricing-Intelligence-Interpretation-Process/tree/v1.3.0/csp) |
| Pricing MCP server | The tools HARVEY calls | `ghcr.io/scorelabus/pi-mcp-server:1.3.0` | [`mcp_server/`](https://github.com/SCORELabUS/Pricing-Intelligence-Interpretation-Process/tree/v1.3.0/mcp_server) |

ORBIT is part of the SPHERE API, not one of these services. The images are built for `linux/amd64`; on Apple Silicon, Docker runs them under emulation.

### Enable them

They need an OpenAI API key, or a [self-hosted, OpenAI-compatible model](https://sphere-docs.vercel.app/docs/2.0.1/api/sphere/self-hosting/ai-assistants) such as Ollama or vLLM. In the quick-start stack:

```bash
cd docker/testing
echo "OPENAI_API_KEY=sk-..." > .env
docker compose -f docker-compose.yml -f docker-compose.ai.yml up -d
```

The same key enables ORBIT's chat. On your own instance, set `OPENAI_API_KEY` in `docker/self-hosted/.env` and run `docker compose --profile ai up -d`. Without a key, the services start, HARVEY answers `503` and ORBIT reports that it is unavailable.

### What works without them

| Feature | Without the AI services or an OpenAI key |
| --- | --- |
| Pricing editor, versions, collections, organizations and permissions | Available |
| Analytics (configuration space, prices and their evolution, computed with MiniZinc in the API) | Available |
| REST API, permanent links and anonymous links | Available |
| ORBIT's MCP server (`/api/v1/orbit/mcp`) | Available: it calls no language model. Connect your own assistant with an API key or OAuth |
| ORBIT's chat | Needs a key (or a self-hosted model); not the AI services |
| HARVEY | Needs the AI services and a key (or a self-hosted model) |
| Extraction of pricings from web pages (A-MINT) | Needs the AI services and a key (or a self-hosted model) |

The public instance at [sphere.score.us.es](https://sphere.score.us.es) has all of them enabled.

## Architecture

| Component | Technology | Location |
| --- | --- | --- |
| Web client | React, Vite, Tailwind CSS | [`frontend/`](frontend) |
| API, ORBIT and MCP server | Node.js, Express, TypeScript | [`api/`](api) |
| Database | MongoDB 7 | |
| Cache, rate limits, sign-in state | Redis 7 | |
| Analytics solver | MiniZinc with Gecode | Inside the API image |
| Reverse proxy | nginx | [`nginx/`](nginx) |
| HARVEY, A-MINT and analysis engines | Python, Node.js, Java | [PIIP](https://github.com/SCORELabUS/Pricing-Intelligence-Interpretation-Process), see [AI services](#ai-services) |

nginx sends `/api/v1` and `/static` to the API, `/harvey-api` to HARVEY and everything else to the web client.

## Documentation

| Document | Content |
| --- | --- |
| [SPHERE documentation](https://sphere-docs.vercel.app/docs/2.0.1/api/sphere/introduction) | Concepts, user guide and self-hosting |
| [API reference](api/docs/sphere-api-docs.yaml) | OpenAPI specification of the REST API |
| [Permanent links](docs/permanent-links.md) | Permanent links, the public synchronization API and SPACE |
| [SCORETech Identity](docs/scoretech-identity.md) | Centralized sign-in (`AUTH_PROVIDER=scoretech`), account linking and rollback |
| [Contributing](docs/CONTRIBUTING.md) | Development setup, tests and conventions |
| [Releasing](docs/RELEASING.md) | How a release is made |
| [`AGENTS.md`](AGENTS.md) | Detailed notes on the codebase for contributors and coding agents |

## Development

You need Node.js 22, pnpm, Docker and MiniZinc with Gecode.

```bash
pnpm run install     # install the API and web client dependencies
pnpm run dev:setup   # start MongoDB and Redis with test data
pnpm run dev         # API on :8080, web client on :5173
pnpm run test        # web client and API tests
```

The [contributing guide](docs/CONTRIBUTING.md) explains the environment files, the repository layout and the conventions for pull requests and commits.

## Contributing

Contributions are welcome. Read the [contributing guide](docs/CONTRIBUTING.md), and report bugs or propose features in [GitHub Issues](https://github.com/SCORELabUS/SPHERE/issues).

## Related projects

- [Pricing Intelligence Interpretation Process (PIIP)](https://github.com/SCORELabUS/Pricing-Intelligence-Interpretation-Process): HARVEY, A-MINT and the pricing analysis engines.
- [SPHERE ORBIT plugin](https://github.com/SCORELabUS/sphere-orbit-plugin): use SPHERE from Claude or ChatGPT.
- [SPACE](https://sphere-docs.vercel.app/docs/2.0.1/api/space/introduction): pricing-driven feature toggling for SaaS applications, which can synchronize pricings from SPHERE.

## License

SPHERE is released under the [MIT License](LICENSE). It is a research prototype under active development, provided without warranty of any kind.

## Acknowledgements

SPHERE is developed by the [SCORE Lab](https://github.com/SCORELabUS) within the research of the [ISA Group](https://www.isa.us.es/3.0/) at the University of Seville.
