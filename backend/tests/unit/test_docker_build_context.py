"""The optional collector image must never ingest the parent OSS workspace."""

from pathlib import Path

BACKEND = Path(__file__).parents[2]
REPOSITORY = BACKEND.parent


def test_collector_build_context_is_scoped_to_the_backend() -> None:
    compose = (REPOSITORY / "frontend" / "docker-compose.yml").read_text()

    collector = compose.split("  collector:", maxsplit=1)[1].split("  frontend:", maxsplit=1)[0]
    assert "context: ../backend" in collector
    assert "dockerfile: demo_server/Dockerfile" in collector
    assert "context: ../.." not in collector


def test_collector_dockerfile_never_copies_sibling_repositories() -> None:
    dockerfile = (BACKEND / "demo_server" / "Dockerfile").read_text()

    assert "COPY edge-reco/" not in dockerfile
    assert "COPY edge-proc/" not in dockerfile
    assert "COPY shared-libs-python/" not in dockerfile
    assert "COPY pyproject.toml uv.lock ./" in dockerfile


def test_backend_dockerignore_excludes_host_secrets_and_build_state() -> None:
    patterns = (BACKEND / ".dockerignore").read_text().splitlines()

    for pattern in [".git", ".venv", "**/.env*", "**/private.key", "**/*.pem"]:
        assert pattern in patterns
