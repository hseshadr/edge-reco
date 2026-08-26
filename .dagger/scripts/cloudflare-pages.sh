#!/bin/sh
set -eu
mode=$1
api="${CLOUDFLARE_API_BASE:-https://api.cloudflare.com/client/v4}"
base="$api/accounts/$CLOUDFLARE_ACCOUNT_ID/pages/projects/edge-reco"
request() { path=$1; shift; printf 'url = "%s%s"\nheader = "Authorization: Bearer %s"\n' "$base" "$path" "$CLOUDFLARE_API_TOKEN" | curl -sS --config - "$@"; }
api_error() { error=$(jq -r '.errors[]? | "Cloudflare Pages API error \(.code): \(.message)"' "$1" 2>/dev/null || :); test -n "$error" || error='Cloudflare Pages API response was invalid'; printf '%s\n' "$error" >&2; }
deployments() { result=$(mktemp); request '/deployments?env=production&per_page=10' --fail-with-body -o "$result" 2>/dev/null || { api_error "$result"; return 1; }; jq -e '.success == true and (.result | type == "array")' "$result" >/dev/null 2>&1 || { api_error "$result"; return 1; }; }
case "$mode" in
  disable) result=$(mktemp); request '' --fail-with-body -X PATCH -H 'Content-Type: application/json' --data '{"source":{"type":"github","config":{"production_deployments_enabled":false,"preview_deployment_setting":"none"}}}' -o "$result" 2>/dev/null || { api_error "$result"; exit 1; }
		jq -e '.success and (.result.source.config.production_deployments_enabled == false) and (.result.source.config.preview_deployment_setting == "none")' "$result"
    ;;
  preflight) deployments ;;
  verify)
		deadline=$(($(date +%s) + ${DEPLOY_VERIFY_TIMEOUT_SECONDS:-60})); delay=1
		until deployments && jq -e --arg sha "$EXPECTED_SHA" '.success and any(.result[]; .environment == "production" and .deployment_trigger.metadata.commit_hash == $sha and .latest_stage.name == "deploy" and .latest_stage.status == "success")' "$result"; do
			test "$(date +%s)" -lt "$deadline" || { echo "Pages API timed out for $EXPECTED_SHA" >&2; exit 1; }; sleep "$delay"; delay=$((delay < 8 ? delay * 2 : 8)); done
    ;;
  *) echo "usage: cloudflare-pages.sh disable|preflight|verify" >&2; exit 2 ;;
esac
