from edgereco.config import Settings


def test_default_settings() -> None:
    settings = Settings()
    assert settings.catalog_url == ""
    assert settings.cache_dir.name == ".edgereco"
    assert settings.embedding_model == "sentence-transformers/all-MiniLM-L6-v2"
    assert settings.search_limit == 10
    assert settings.rrf_k == 60


def test_settings_from_env(monkeypatch: object) -> None:
    import pytest
    with pytest.MonkeyPatch.context() as mp:
        mp.setenv("EDGERECO_CATALOG_URL", "http://edge:8081/manifest.json")
        mp.setenv("EDGERECO_CACHE_DIR", "/tmp/test-cache")  # noqa: S108
        mp.setenv("EDGERECO_SEARCH_LIMIT", "20")
        settings = Settings()
        assert settings.catalog_url == "http://edge:8081/manifest.json"
        assert str(settings.cache_dir) == "/tmp/test-cache"  # noqa: S108
        assert settings.search_limit == 20
