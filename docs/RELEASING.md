# How to Release a New Version of SPHERE

This guide outlines the process for releasing a new version of SPHERE.

## Prerequisites (One-Time Setup)

> [!NOTE]
> If your repository already has the changelog GitHub Action configured, skip directly to [Release checklist](#release-checklist).

Add a workflow file (e.g., `.github/workflows/changelog.yml`) to your repository with the following configuration:
```yaml
name: Generate changelog
on:
  push:
    tags:
      - '*'

permissions:
  contents: write

jobs:
  changelog:
    name: Generate changelog
    runs-on: ubuntu-latest
    steps:
      - name: Checkout repository
        uses: actions/checkout@v7
        with:
          fetch-depth: 0
      - name: Generate changelog
        uses: SCORELabUS/Pricing-Intelligence-Interpretation-Process/.github/actions/sphere-changelog@0f7adf2b4d69853401a753c213b322cebd6f3802 # v1.3.0
        with:
          gemini_api_key: ${{ secrets.GEMINI_API_KEY }}
```

> [!NOTE]
> To use `sphere-changelog` action, you *MUST* configure your workflow with at least `contents: write` in `permissions`.

Read the [usage guide](https://github.com/SCORELabUS/Pricing-Intelligence-Interpretation-Process/tree/main/.github/actions/sphere-changelog/README.md) to configure the action properly. Pin it to the commit of a PIIP release, as above, rather than to a branch.

Commit and push the workflow:
```bash
git add .github/workflows/changelog.yml
git commit -m "feat: add sphere-changelog workflow"
git push
```

## Release checklist

A release ships the exact builds it was tested with: every image is pinned by version, and the AI services also by digest. Never ship a release with floating tags such as `main` or `latest`.

### 1. Prepare `develop`

1. **Bump the version** in `package.json`, `api/package.json` and `frontend/package.json`, e.g. `chore(release): bump version to X.Y.Z`.

2. **Pin the AI services.** HARVEY, A-MINT, the analysis engines and the pricing MCP server come from
   [PIIP](https://github.com/SCORELabUS/Pricing-Intelligence-Interpretation-Process) (Pricing Intelligence Interpretation Process).
   Check that the Compose files point to the PIIP release you want to ship. If they do not, pin it
   (the GHCR packages must be public); the script resolves the digests and updates the four Compose files:

   ```bash
   scripts/pin-ai-images.sh 1.3.0
   git add docker && git commit -m "chore(docker): pin AI services to 1.3.0"
   ```

   Then update the PIIP version named in the README's [AI services](../README.md#ai-services) section.

3. **Pin the self-hosting kit to this release.** `docker/self-hosted` falls back to the release it ships with:

   ```bash
   sed -i.bak -E 's/(sphere-(api|client):\$\{SPHERE_VERSION:-)[0-9.]+/\1X.Y.Z/' docker/self-hosted/docker-compose.yml && rm docker/self-hosted/docker-compose.yml.bak
   ```

4. **Check that nothing floats.** This must print nothing:

   ```bash
   git grep -nE 'image: [^@]*:(main|latest)\b|image: [^:@]+$|@main\b' -- docker .github
   ```

### 2. Promote `develop` to `main`

Open a pull request from `develop` to `main` titled `Release X.Y.Z`, and merge it once CI passes.

### 3. Tag the release

Create and push a Git tag on `main` to trigger the `Generate changelog` workflow, which creates a draft release with a `changelog-<tag>.json` asset.

```bash
git checkout main && git pull
git tag -a -m "Release X.Y.Z of SPHERE" vX.Y.Z
git push origin vX.Y.Z
```

The changelog is built from the [Conventional Commits](CONTRIBUTING.md#commit-messages) since the previous tag, so keep commit messages to those conventions.

### 4. Publish it

Review the draft release, name it `SPHERE X.Y.Z` and publish it. Publishing runs the `Publish Docker images` workflow, which builds `ghcr.io/scorelabus/sphere-api` and `sphere-client` tagged `X.Y.Z` and `latest`.

### 5. Rebuild and redeploy

To execute the build script that aggregates the changelogs, store a GitHub fine-grained personal access token
in the `docker/gh_pat.txt` file.

Create a fine-grained Personal Access Token (PAT) with read-only access to public repositories. See the [GitHub documentation](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)
for more details.

After placing the token in `docker/gh_pat.txt`, rebuild the Docker images:
```bash
docker compose -f docker/production/docker-compose.yml build --no-cache
```

> [!NOTE]
> Use `--no-cache` flag to make sure the changelog build step is executed again.

> [!NOTE]
> The build script `frontend/scripts/generate-changelog.js` is used to aggregate all uploaded
> changelog files across releases. See the frontend `Dockerfiles` and the script for more
> details.

Finally, redeploy SPHERE:
```bash
docker compose -f docker/production/docker-compose.yml up --detach
```
