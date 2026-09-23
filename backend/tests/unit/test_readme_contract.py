"""The root README keeps the portfolio template's first screen.

The first screen (title → tagline → badges → hero → "At a glance" → "Try it in 60
seconds") is written for a smart non-specialist, and it drifts the moment nobody checks
it: a tagline edited in the README but not in pyproject, a fifth badge, a renamed label,
a dropped hero caption, a relative link to a file that moved. Deliberately dumb: string
and regex checks only, no markdown parser — it guards shape, not prose.
"""

from __future__ import annotations

import re
import tomllib
from pathlib import Path
from urllib.parse import unquote

_ROOT = Path(__file__).resolve().parents[3]
_README = (_ROOT / "README.md").read_text(encoding="utf-8")

_AT_A_GLANCE = "## At a glance"
_TRY_IT = "## Try it in 60 seconds"
_HOW_IT_WORKS = "## How it works"
_LABELS = (
    "**What it does**",
    "**Who it's for**",
    "**What stays on your device / what leaves it**",
    "**Runs on**",
    "**Not for**",
    "**Status**",
)
_FENCE = re.compile(r"^```.*?^```", re.MULTILINE | re.DOTALL)
_LINK = re.compile(r"\]\(([^)\s]+)(?:\s+\"[^\"]*\")?\)")
_SCHEME = re.compile(r"^[a-z][a-z0-9+.-]*:", re.IGNORECASE)


def _description() -> str:
    pyproject = tomllib.loads((_ROOT / "backend" / "pyproject.toml").read_text(encoding="utf-8"))
    description = pyproject["project"]["description"]
    assert isinstance(description, str)
    return description


def _tagline() -> str:
    for line in _README.splitlines()[1:]:
        text = line.strip()
        if text and not text.startswith("[![") and not text.startswith("<!--"):
            return text
    return ""


def _relative_links() -> list[str]:
    prose = _FENCE.sub("", _README)
    targets = _LINK.findall(prose)
    return [t for t in targets if not _SCHEME.match(t) and not t.startswith("#")]


def test_should_open_with_a_title_and_the_package_description_as_tagline() -> None:
    # Given / When
    tagline = _tagline()

    # Then
    assert re.match(r"^# \S", _README.splitlines()[0])
    assert 0 < len(tagline) <= 120
    assert tagline == _description()


def test_should_show_at_most_four_badges_before_at_a_glance() -> None:
    # Given
    glance = _README.index(_AT_A_GLANCE)

    # When
    badges = _README[:glance].count("[![")

    # Then
    assert badges <= 4


def test_should_put_every_bolded_label_on_the_first_screen() -> None:
    # Given
    first_screen = _README[: _README.index(_HOW_IT_WORKS)]

    # Then
    for label in _LABELS:
        assert f"- {label} — " in first_screen, label


def test_should_order_caption_then_try_it_then_how_it_works() -> None:
    # Given
    caption = _README.index("Real output of the example below")

    # Then
    assert caption < _README.index(_TRY_IT) < _README.index(_HOW_IT_WORKS)


def test_should_link_the_interactive_architecture_map() -> None:
    # Then
    map_link = (
        r"\[\*{0,2}Explore the interactive architecture map[^\]]*\]"
        r"\(docs/architecture/index\.html\)"
    )
    assert re.search(map_link, _README)
    assert (_ROOT / "docs" / "architecture" / "runtime.architecture.json").is_file()


def test_should_resolve_every_relative_link_to_a_path_in_the_repo() -> None:
    # Given
    links = _relative_links()

    # When
    missing = [t for t in links if not (_ROOT / unquote(t.split("#")[0])).exists()]

    # Then
    assert links
    assert missing == []
