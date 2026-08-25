#!/bin/sh
set -eu

repository=$1
ref=$2
commit=$3
for language in javascript-typescript python; do
  printf '%s' "$GITHUB_TOKEN" | /opt/codeql/codeql github upload-results \
    --github-auth-stdin "--repository=$repository" "--ref=$ref" "--commit=$commit" \
    "--sarif=/sarif/$language.sarif"
done
