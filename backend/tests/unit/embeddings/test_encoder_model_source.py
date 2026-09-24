"""The embedding model is fail-closed about the network (edge-proc >=0.4.0).

edge-proc's ``TextEncoder`` refuses to fetch a model unless ``EDGEPROC_MODEL_PATH``
points at a local model directory or ``EDGEPROC_ALLOW_MODEL_DOWNLOAD=1`` opts a build
machine into a one-time download. EdgeReco keeps that refusal: it never sets either
variable on the caller's behalf, and its CLI renders the refusal as a coded error that
names both remedies instead of a traceback. The suite itself opts in from
``tests/conftest.py``, so these tests clear both variables first.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from edgeproc.localvec.model_source import ModelNotLocalError, ModelPathInvalidError
from typer.testing import CliRunner

from edgereco.cli import app
from edgereco.embeddings.encoder import ProductEncoder

runner = CliRunner()


@pytest.fixture
def no_model_configured(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in ("EDGEPROC_ALLOW_MODEL_DOWNLOAD", "EDGEPROC_MODEL_PATH", "EDGEPROC_MODEL_DIGEST"):
        monkeypatch.delenv(name, raising=False)


@pytest.mark.usefixtures("no_model_configured")
def test_product_encoder_refuses_to_fetch_without_a_local_model() -> None:
    with pytest.raises(ModelNotLocalError, match="EDGEPROC_MODEL_PATH"):
        ProductEncoder()


def test_product_encoder_refuses_a_model_path_that_is_not_a_directory(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setenv("EDGEPROC_MODEL_PATH", str(tmp_path / "missing"))
    with pytest.raises(ModelPathInvalidError):
        ProductEncoder()


@pytest.mark.usefixtures("no_model_configured")
def test_cli_index_renders_the_model_refusal_as_a_coded_error(tmp_path: Path) -> None:
    cache = tmp_path / "cache"
    cache.mkdir()
    (cache / "products.jsonl").write_text(
        '{"id":"P1","title":"Widget","category":"Electronics"}\n', encoding="utf-8"
    )

    result = runner.invoke(app, ["index", str(cache), str(tmp_path / "index")])

    assert result.exit_code == 1
    assert "[config.missing]" in result.output
    assert "EDGEPROC_ALLOW_MODEL_DOWNLOAD=1" in result.output
    assert result.exception is None or isinstance(result.exception, SystemExit)


@pytest.mark.usefixtures("no_model_configured")
def test_cli_search_renders_the_model_refusal_as_a_coded_error(tmp_path: Path) -> None:
    cache = tmp_path / "cache"
    cache.mkdir()
    (cache / "products.jsonl").write_text(
        '{"id":"P1","title":"Widget","category":"Electronics"}\n', encoding="utf-8"
    )

    (cache / "manifest.json").write_text(
        '{"catalog_id":"c","version":"v1","embedding_model":'
        '"sentence-transformers/all-MiniLM-L6-v2","files":[]}',
        encoding="utf-8",
    )

    result = runner.invoke(app, ["search", "widget", str(cache), str(tmp_path / "index")])

    assert result.exit_code == 1
    assert "[config.missing]" in result.output
    assert result.exception is None or isinstance(result.exception, SystemExit)
