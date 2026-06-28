---
name: Bug report
about: Report a reproducible problem in EdgeReco
title: "[Bug] "
labels: bug
assignees: ""
---

**Describe the bug**
A clear and concise description of what the bug is.

**To reproduce**
Steps or a minimal snippet / CLI invocation that triggers it:

```bash
# e.g. edgereco index cache index   (or the in-browser flow: search → click → re-rank)
```

**Expected behavior**
What you expected to happen.

**Actual behavior**
What actually happened (include the full error / traceback and exit code).

**Environment**
- EdgeReco version (`pip show edgereco`, or the git tag / commit):
- Python version (`python --version`, should be 3.13+):
- OS / browser (note the browser version for the in-browser tier):
- Tier (in-browser SPA, FastAPI edge server, or CLI):

**Additional context**
Anything else that helps — config, `EDGERECO_`-prefixed env vars, sample catalog/bundle.

> ⚠️ For **security vulnerabilities**, do NOT file a public issue — see [SECURITY.md](../../SECURITY.md).
