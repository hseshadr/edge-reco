#!/bin/sh
set -eu
mkdir /canary && cd /canary
git init -q
git config user.email canary@example.invalid && git config user.name Canary
{ printf '\147\150\160\137'; printf edge-reco-canary | sha256sum | cut -c1-36; } >leak
git add leak
git commit -qm canary
set +e
gitleaks detect --source . --no-banner >/tmp/canary.log 2>&1
status=$?
set -e
test "$status" -eq 1 || { cat /tmp/canary.log; exit 1; }
