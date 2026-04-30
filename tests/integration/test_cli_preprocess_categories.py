"""edgereco preprocess --category flag overrides the default 5-category set."""

from __future__ import annotations

import json
from pathlib import Path

from typer.testing import CliRunner

from edgereco.cli import app


def _make_csv(tmp: Path) -> Path:
    src = tmp / "in.csv"
    src.write_text(
        "asin,title,category_id,stars,reviews,boughtInLastMonth,price,imgUrl,productURL\n"
        "A,bag,Luggage,4,10,1,9.99,,\n"
        "B,book,Books,5,20,2,12.0,,\n"
    )
    return src


def test_default_categories_drop_luggage(tmp_path: Path) -> None:
    out = tmp_path / "out"
    runner = CliRunner()
    result = runner.invoke(app, ["preprocess", str(_make_csv(tmp_path)), str(out)])
    assert result.exit_code == 0, result.output
    products = (out / "products.jsonl").read_text().strip().splitlines()
    ids = [json.loads(p)["id"] for p in products]
    assert ids == ["B"]


def test_custom_category_keeps_luggage(tmp_path: Path) -> None:
    out = tmp_path / "out"
    runner = CliRunner()
    result = runner.invoke(
        app,
        ["preprocess", str(_make_csv(tmp_path)), str(out), "--category", "Luggage"],
    )
    assert result.exit_code == 0, result.output
    products = (out / "products.jsonl").read_text().strip().splitlines()
    ids = [json.loads(p)["id"] for p in products]
    assert ids == ["A"]
