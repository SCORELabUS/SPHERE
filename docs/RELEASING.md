# How to Release a New Version of SPHERE

This guide outlines the process for releasing a new version of SPHERE.

## Prerequisites (One-Time Setup)

> [!NOTE]
> If your repository already has the changelog GitHub Action configured, skip directly to [Release process](#release-process).

Add a workflow file (e.g., `.github/workflows/changelog.yml`) to your repository with the following configuration:
```yaml
name: Generate changelog
on:
  push:
    tags:
      - '*'

permissions:
  contents: read

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
        uses: isa-group/Pricing-Intelligence-Interpretation-Process/.github/actions/sphere-changelog@main
        with:
          gemini_api_key: ${{ secrets.GEMINI_API_KEY }}
```

Read the [usage guide](https://github.com/isa-group/Pricing-Intelligence-Interpretation-Process/tree/main/.github/actions/sphere-changelog/README.md) to configure `isa-group/Pricing-Intelligence-Interpretation-Process/.github/actions/sphere-changelog@main` properly.

Commit and push the workflow:
```bash
git add .github/workflows/changelog.yml
git commit -m "feat: add sphere-changelog workflow"
git push
```

## Release process

Create and push a Git tag to trigger the `Generate changelog` workflow, which automatically creates a draft release with a `changelog-<tag>.json` asset.

Create a tag in your local repository (`git tag -a -m <msg> <tag>`):
```bash
git tag -a -m "Release X.X.X of ACME repository" vX.X.X
```

Push and upload the tag to the remote repository:
```bash
git push
git push origin vX.X.X
```

The next step is running a build script to aggregate all generated assets into SPHERE.

### Rebuild and Redeploy the Application

To execute the build script that aggregates the changelogs, store a GitHub fine-grained personal access token
in the `docker/gh_token.txt` file.

Create a fine-grained Personal Access Token (PAT) with read-only access to public repositories. See the [GitHub documentation](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)
for more details.

After placing the token in `docker/gh_token.txt`, rebuild the Docker images:
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
