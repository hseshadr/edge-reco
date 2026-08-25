#!/bin/sh
set -eu
mode=$1
commit=$2
case "$mode" in
  preflight)
		pnpm exec wrangler --version | grep -Fx '4.103.0'
		pnpm exec wrangler pages deploy --help >/dev/null
		ARTIFACT_DIR=/artifact EXPECTED_SHA="$commit" node --test \
			--test-name-pattern='mounted artifact' app/scripts/release-verify.test.mjs
    ;;
  deploy)
    pnpm exec wrangler pages deploy /artifact --project-name=edge-reco \
      --branch=main "--commit-hash=$commit" --commit-dirty=false
    ;;
  verify)
		deployments=$(mktemp) && pnpm exec wrangler pages deployment list --project-name=edge-reco \
			--environment=production --json >"$deployments"
		DEPLOYMENTS_PATH="$deployments" EXPECTED_SHA="$commit" node --test \
			--test-name-pattern='Cloudflare list' app/scripts/release-verify.test.mjs
    ;;
  *) echo "usage: wrangler-release.sh preflight|deploy|verify SHA" >&2; exit 2 ;;
esac
