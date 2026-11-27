#!/usr/bin/env bash
# Pins SPHERE's AI service images to a release of
# https://github.com/SCORELabUS/Pricing-Intelligence-Interpretation-Process.
# It resolves each image's digest in GHCR and rewrites the Docker Compose
# files as ghcr.io/scorelabus/<service>:<version>@sha256:<digest>.
#
#   scripts/pin-ai-images.sh 1.2.1
set -euo pipefail

VERSION="${1:?usage: $0 <version, e.g. 1.2.0>}"
VERSION="${VERSION#v}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OWNER="scorelabus"
SERVICES=(choco-pricing-analysis-engine pricing-analysis-engine a-mint pi-mcp-server harvey)
FILES=(
  "$ROOT/docker/production/docker-compose.yml"
  "$ROOT/docker/pre-production/docker-compose.yml"
  "$ROOT/docker/testing/docker-compose.ai.yml"
)
ACCEPT="application/vnd.oci.image.index.v1+json,application/vnd.docker.distribution.manifest.list.v2+json,application/vnd.oci.image.manifest.v1+json,application/vnd.docker.distribution.manifest.v2+json"

for service in "${SERVICES[@]}"; do
  repo="$OWNER/$service"
  token="$(curl -fsSL "https://ghcr.io/token?scope=repository:$repo:pull" \
    | sed -E 's/.*"token":"([^"]+)".*/\1/')"
  digest="$(curl -fsSI -H "Authorization: Bearer $token" -H "Accept: $ACCEPT" \
    "https://ghcr.io/v2/$repo/manifests/$VERSION" \
    | tr -d '\r' | awk -F': ' 'tolower($1)=="docker-content-digest"{print $2}')"
  if [[ -z "$digest" ]]; then
    echo "error: ghcr.io/$repo:$VERSION not found (is the package public?)" >&2
    exit 1
  fi
  echo "ghcr.io/$repo:$VERSION@$digest"
  for file in "${FILES[@]}"; do
    perl -pi -e "s#ghcr\.io/$repo:[^\s\"']+#ghcr.io/$repo:$VERSION\@$digest#g" "$file"
  done
done
