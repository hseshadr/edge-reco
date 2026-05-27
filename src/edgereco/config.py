"""Environment-based configuration for EdgeReco."""

from __future__ import annotations

from pathlib import Path

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """EdgeReco configuration loaded from environment variables."""

    model_config = {"env_prefix": "EDGERECO_"}

    catalog_url: str = ""
    cache_dir: Path = Path.home() / ".edgereco"
    embedding_model: str = "sentence-transformers/all-MiniLM-L6-v2"
    search_limit: int = 10
    rrf_k: int = 60
    api_host: str = "0.0.0.0"  # noqa: S104
    api_port: int = 8000
    # Bundle producer/consumer (signed, content-addressed catalog distribution).
    bundle_base_url: str | None = None
    verify_key_path: Path | None = None
    bundle_cache_dir: Path = Path.home() / ".edgereco" / "bundle"
