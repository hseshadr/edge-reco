"""Supply-chain contract for EdgeReco's published Assay dependency."""

from __future__ import annotations

import tomllib
from pathlib import Path

BACKEND_ROOT = Path(__file__).parents[2]
PYPROJECT = tomllib.loads((BACKEND_ROOT / "pyproject.toml").read_text())
LOCK = tomllib.loads((BACKEND_ROOT / "uv.lock").read_text())
REQUIREMENT = "assay-engine[metrics]==0.5.0.dev3"
WHEEL_SHA256 = "72beb0a3b33962147e5174c7b71feb629cd76b8b0efbd127f52ed6a43c1f2f43"
SDIST_SHA256 = "303ef50ee174ce3d7de1d2ab0401873eb5bc2d09668f47083a991fe7a3a84f62"


def assay_package() -> dict[str, object]:
    """Return the single locked Assay package."""
    matches = [package for package in LOCK["package"] if package["name"] == "assay-engine"]
    assert len(matches) == 1
    return matches[0]


def test_assay_is_an_exact_registry_dependency() -> None:
    """The application must not fall back to a mutable sibling checkout."""
    dependencies = PYPROJECT["project"]["dependencies"]
    assay_requirements = [item for item in dependencies if item.startswith("assay-engine")]
    assert assay_requirements == [REQUIREMENT]
    assert "assay-engine" not in PYPROJECT["tool"]["uv"].get("sources", {})


def test_assay_lock_matches_verified_pypi_artifacts() -> None:
    """The lock must retain the independently verified public artifact hashes."""
    package = assay_package()
    assert package["version"] == "0.5.0.dev3"
    assert package["source"] == {"registry": "https://pypi.org/simple"}
    assert package["sdist"]["hash"] == f"sha256:{SDIST_SHA256}"
    assert {wheel["hash"] for wheel in package["wheels"]} == {f"sha256:{WHEEL_SHA256}"}
