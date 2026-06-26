"""Launch the demo API.

The in-memory index build (`ServiceContainer.from_catalog` →
`VectorIndex.build`) calls `asyncio.run(...)`, which raises if invoked inside an
already-running event loop. Uvicorn's import-string mode imports the app *inside*
its loop, triggering exactly that. So we import the pre-built `app` here (the build
runs at import time, before any loop exists) and hand the ready object to uvicorn.

Launch:
    uv run python -m demo_server.serve
"""

from __future__ import annotations

import os

import uvicorn

from demo_server.main import app


def main() -> None:
    host = os.environ.get("DEMO_HOST", "127.0.0.1")
    port = int(os.environ.get("DEMO_PORT", "8000"))
    uvicorn.run(app, host=host, port=port)


if __name__ == "__main__":
    main()
