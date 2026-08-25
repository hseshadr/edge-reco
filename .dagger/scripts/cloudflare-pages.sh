#!/bin/sh
set -eu
mode=$1
base="https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/pages/projects/edge-reco"
request() {
	path=$1; shift
	printf 'url = "%s%s"\nheader = "Authorization: Bearer %s"\n' "$base" "$path" "$CLOUDFLARE_API_TOKEN" | curl -fsS --config - "$@"
}
case "$mode" in
  disable)
		result=$(mktemp); request '' -X PATCH -H 'Content-Type: application/json' --data '{"source":{"type":"github","config":{"production_deployments_enabled":false,"preview_deployment_setting":"none"}}}' -o "$result"
		jq -e '.success and (.result.source.config.production_deployments_enabled == false) and (.result.source.config.preview_deployment_setting == "none")' "$result"
    ;;
  verify)
		result=$(mktemp); deadline=$(($(date +%s) + ${DEPLOY_VERIFY_TIMEOUT_SECONDS:-60})); delay=1
		until request '?env=production' -o "$result" && jq -e --arg sha "$EXPECTED_SHA" '.success and any(.result[]; .environment == "production" and .deployment_trigger.metadata.commit_hash == $sha and .latest_stage.name == "deploy" and .latest_stage.status == "success")' "$result"; do
			test "$(date +%s)" -lt "$deadline" || { echo "Pages API timed out for $EXPECTED_SHA" >&2; exit 1; }; sleep "$delay"; delay=$((delay < 8 ? delay * 2 : 8)); done
    ;;
  *) echo "usage: cloudflare-pages.sh disable|verify" >&2; exit 2 ;;
esac
