# Contributing to SPHERE

Thanks for your interest in SPHERE. This guide covers setting up a development environment, running the tests and the conventions a pull request should follow.

- [Report a bug or request a feature](#report-a-bug-or-request-a-feature)
- [Development setup](#development-setup)
- [Running the tests](#running-the-tests)
- [Pull requests](#pull-requests)
- [Commit messages](#commit-messages)

## Report a bug or request a feature

Open an [issue](https://github.com/SCORELabUS/SPHERE/issues). For a bug, include the steps to reproduce it, what you expected and what happened, and the SPHERE version or commit. Before working on a large change, open an issue first to agree on the approach.

## Development setup

### Prerequisites

- [Node.js](https://nodejs.org/) 22 or later
- [pnpm](https://pnpm.io/installation), the package manager of the repository
- [Docker](https://docs.docker.com/get-docker/), to run MongoDB and Redis
- [MiniZinc](https://www.minizinc.org/doc-latest/en/installation.html) with the Gecode solver, used by the pricing analytics. `minizinc --solvers` must list `gecode`.

### Set up and run

1. Clone the repository and install the dependencies of both packages:

   ```bash
   git clone https://github.com/SCORELabUS/SPHERE.git
   cd SPHERE
   pnpm run install
   ```

2. Configure the environment. Create `api/.env` from [`api/.env.testing`](../api/.env.testing), with `MONGO_HOST=localhost` and `REDIS_URL=redis://localhost:6378`, and `frontend/.env` from [`frontend/.env.example`](../frontend/.env.example).

3. Start MongoDB and Redis and load the test data:

   ```bash
   pnpm run dev:setup
   ```

4. Run the API and the web client:

   ```bash
   pnpm run dev
   ```

   The API applies pending migrations on startup and listens on <http://localhost:8080>; the web client runs on <http://localhost:5173>. Set `VITE_API_PROXY_TARGET` if the API runs on another port.

### Useful commands

| Command | Description |
| --- | --- |
| `pnpm run dev` | Run the API and the Vite dev server together |
| `pnpm run dev:setup` | Start MongoDB and Redis and load the test data |
| `pnpm run build` | Build the web client and the API |
| `pnpm run test` | Run the web client and API tests, then reload the test data |
| `pnpm run test:frontend` | Run only the web client tests |
| `pnpm run lint` | Lint the repository |
| `pnpm run seed:mongo-local:small` | Reset the local database to the test data |

### Repository layout

| Path | Content |
| --- | --- |
| [`api/`](../api) | Express API in TypeScript: routes, controllers, services, MongoDB repositories, migrations and tests |
| [`frontend/`](../frontend) | React web client, organized in modules under `src/modules` |
| [`nginx/`](../nginx) | Reverse proxy configurations |
| [`docker/`](../docker) | Docker Compose stacks: `testing` (local demo), `self-hosted`, `production` and `pre-production` |
| [`docs/`](.) | Repository documentation |

[`AGENTS.md`](../AGENTS.md) describes the codebase in detail: how features are built, where their tests live and the rules for adding endpoints, database entities and UI components. Read the parts that touch your change.

## Running the tests

The API tests use [Vitest](https://vitest.dev/) against a real MongoDB and Redis, and run one file at a time. The web client tests use Vitest and Node's test runner.

```bash
pnpm run test
```

To run some API tests only:

```bash
cd api
npx vitest --run --test-name-pattern "<pattern>"
```

> [!CAUTION]
> The integration and end-to-end harnesses drop the database they use. Run them only against a dedicated test database, never against data you want to keep.

## Pull requests

- Branch from `develop` and open the pull request against `develop`.
- Keep each pull request to one change, with tests for new behavior and the documentation it affects, including [`api/docs/sphere-api-docs.yaml`](../api/docs/sphere-api-docs.yaml) for API changes.
- Make sure `pnpm run test` and `pnpm run lint` pass.

## Commit messages

This project uses the [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/#specification) specification.

The following commit types are defined:

- `feat`: adding features, changing behavior or removing functionality.
- `fix`: correcting bugs.
- `docs`: changing documentation.
- `refactor`: restructuring code without changing behavior.
- `chore`: correcting typos, formatting, deleting unnecessary files and similar.

> [!IMPORTANT]
> Each commit should contain the smallest possible set of changes. If a change spans multiple
> types, stage fewer files and split it into smaller separate commits.

Some valid commit messages:

```txt
feat: enforce commit style conventions
fix: infinite call to permissions in pricings tab
refactor: order when navigating on user menu
chore: deactivated harvey chat in pricing card
```

[Husky](https://typicode.github.io/husky/) runs [commitlint](https://commitlint.js.org/) on every commit, so a commit with an invalid message is rejected with an explanation.

> [!NOTE]
> To bypass the commit hooks, pass `--no-verify` (or `-n`) to `git commit`, for example `git commit -m "feat: add some module" -n`.
