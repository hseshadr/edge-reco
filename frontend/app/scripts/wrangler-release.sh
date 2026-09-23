#!/bin/sh
set -eu
mode=$1
commit=$2
case "$mode" in
  preflight)
		# The exact pin lives only in frontend/package.json, so a Dependabot bump
		# moves the dependency and this check together.
		expected=$(node -p 'require(process.argv[1]).devDependencies.wrangler' "$(cd "$(dirname "$0")/../.." && pwd)/package.json")
		pnpm exec wrangler --version | grep -Fx "$expected" && pnpm exec wrangler pages deploy --help >/dev/null
		ARTIFACT_DIR=/artifact EXPECTED_SHA="$commit" node --test \
			--test-name-pattern='mounted artifact' app/scripts/release-verify.test.mjs
    ;;
  *) echo "usage: wrangler-release.sh preflight SHA" >&2; exit 2 ;;
esac
