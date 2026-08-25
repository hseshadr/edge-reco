#!/bin/sh
set -eu

for language in javascript-typescript python; do
  database="/db/$language"
  sarif="/sarif/$language.sarif"
  /opt/codeql/codeql database create "$database" \
    "--language=$language" --build-mode=none --source-root=/src
  /opt/codeql/codeql database analyze "$database" \
    --format=sarifv2.1.0 "--sarif-category=$language" "--output=$sarif"
  python3 -c \
    "import json,sys; data=json.load(open(sys.argv[1], encoding='utf-8')); assert data['version']=='2.1.0' and data['runs']" \
    "$sarif"
done
