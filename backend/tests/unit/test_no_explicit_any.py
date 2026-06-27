"""Guard: no explicit ``Any`` may appear in any annotation across ``src/edgereco``.

The explicit-``Any`` ban is enforced by ruff ``ANN401`` (function arg/return
annotations) and mypy ``disallow_any_explicit`` — but mypy carves out the 10
Pydantic-model modules to dodge Pydantic's injected
``__pydantic_extra__: dict[str, Any]``. That leaves one theoretical gap: a model
*field* annotation such as ``meta: dict[str, Any]`` inside a carved-out module would
evade both tools (``ANN401`` only inspects function signatures). This AST test closes
it — it rejects ``Any`` in every annotation node (argument, return, and assignment)
regardless of tool configuration. Docstrings/comments that merely mention
``dict[str, Any]`` are string literals, not annotation nodes, so they are ignored.
"""

from __future__ import annotations

import ast
from pathlib import Path

_SRC = Path(__file__).resolve().parents[2] / "src" / "edgereco"


def _annotation_nodes(tree: ast.AST) -> list[ast.expr]:
    nodes: list[ast.expr] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.arg) and node.annotation is not None:
            nodes.append(node.annotation)
        elif isinstance(node, ast.FunctionDef | ast.AsyncFunctionDef) and node.returns:
            nodes.append(node.returns)
        elif isinstance(node, ast.AnnAssign):
            nodes.append(node.annotation)
    return nodes


def _mentions_any(annotation: ast.expr) -> bool:
    return any(
        (isinstance(sub, ast.Name) and sub.id == "Any")
        or (isinstance(sub, ast.Attribute) and sub.attr == "Any")
        for sub in ast.walk(annotation)
    )


def _violations(path: Path) -> list[int]:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    return [node.lineno for node in _annotation_nodes(tree) if _mentions_any(node)]


def test_no_explicit_any_in_src() -> None:
    found: dict[str, list[int]] = {}
    for path in sorted(_SRC.rglob("*.py")):
        lines = _violations(path)
        if lines:
            found[str(path.relative_to(_SRC))] = lines
    assert not found, f"explicit `Any` in annotations (banned): {found}"
