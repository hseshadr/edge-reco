"""Generate a 1000-product synthetic demo catalog for EdgeReco.

Run: uv run python scripts/generate_demo_catalog.py
Writes: examples/catalog/products.jsonl + examples/catalog/manifest.json
"""
from __future__ import annotations

import hashlib
import random
from pathlib import Path

from edgereco.catalog.models import CatalogFile, CatalogManifest, Product

OUT_DIR = Path(__file__).parent.parent / "examples" / "catalog"
PER_CATEGORY = 200

CATEGORIES = {
    "Electronics": {
        "subcats": [
            ("Audio", ["headphones", "speakers", "earbuds"]),
            ("Computers", ["laptop", "keyboard", "mouse"]),
            ("Mobile", ["phone case", "charger", "screen protector"]),
            ("Cameras", ["mirrorless", "tripod", "lens"]),
        ],
        "title_patterns": [
            "Wireless {item} Pro",
            "Smart {item} 2026",
            "Portable {item} HD",
            "Premium {item} Set",
            "Compact {item} Mini",
        ],
        "brands": ["SoundMax", "TechCore", "AudioPeak", "VoltEdge", "NovaTech"],
    },
    "Clothing": {
        "subcats": [
            ("Men", ["shirt", "jeans", "jacket"]),
            ("Women", ["dress", "blouse", "leggings"]),
            ("Athletic", ["running shorts", "tank top", "compression sleeve"]),
            ("Outerwear", ["parka", "rain jacket", "vest"]),
        ],
        "title_patterns": [
            "Cotton {item} Classic",
            "Performance {item} Stretch",
            "Vintage {item} Slim Fit",
            "Premium {item} Tailored",
            "Active {item} Lightweight",
        ],
        "brands": ["UrbanStyle", "FitWear", "ThreadCo", "PeakAttire", "Looma"],
    },
    "Home & Kitchen": {
        "subcats": [
            ("Cookware", ["skillet", "stockpot", "saucepan"]),
            ("Appliances", ["blender", "toaster", "kettle"]),
            ("Drinkware", ["water bottle", "coffee mug", "wine glass set"]),
            ("Storage", ["food container", "spice rack", "shelf organizer"]),
        ],
        "title_patterns": [
            "Stainless Steel {item}",
            "Non-Stick {item} Pro",
            "Bamboo {item} Set",
            "Cast Iron {item} Heritage",
            "BPA-Free {item} Insulated",
        ],
        "brands": ["HydroKeep", "ChefLine", "HearthCraft", "PureCook", "NestKit"],
    },
    "Sports": {
        "subcats": [
            ("Yoga", ["mat", "block", "strap"]),
            ("Fitness", ["dumbbell", "resistance band", "jump rope"]),
            ("Outdoor", ["backpack", "tent", "trekking pole"]),
            ("Cycling", ["helmet", "bike lock", "saddle"]),
        ],
        "title_patterns": [
            "Premium {item} Pro",
            "Adjustable {item} Set",
            "Lightweight {item} Series",
            "Heavy-Duty {item} Plus",
            "Performance {item} Elite",
        ],
        "brands": ["ZenFit", "VeloGuard", "TrailWise", "PeakForm", "FlexPro"],
    },
    "Books": {
        "subcats": [
            ("Programming", ["python guide", "rust handbook", "system design book"]),
            ("Self-Help", ["productivity manual", "habits playbook", "mindfulness journal"]),
            ("Business", ["startup primer", "leadership reader", "finance handbook"]),
            ("Fiction", ["mystery novel", "sci-fi anthology", "literary debut"]),
        ],
        "title_patterns": [
            "The {item}",
            "Mastering the {item}",
            "Essential {item}",
            "Modern {item}",
            "{item}: A Practical Guide",
        ],
        "brands": ["TechPress", "PeakBooks", "OrbitHouse", "PenForge", "BluePine"],
    },
}


def generate_products(seed: int = 42) -> list[Product]:
    rng = random.Random(seed)  # noqa: S311 - reproducible fixture, not crypto
    products: list[Product] = []
    pid = 1
    for category, spec in CATEGORIES.items():
        for _ in range(PER_CATEGORY):
            subcat_name, items = rng.choice(spec["subcats"])
            item = rng.choice(items)
            pattern = rng.choice(spec["title_patterns"])
            title = pattern.format(item=item).title()
            brand = rng.choice(spec["brands"])
            tag_pool = [item.replace(" ", "-"), subcat_name.lower(), category.lower().split(" ")[0]]
            tags = rng.sample(tag_pool, k=min(3, len(tag_pool)))
            products.append(
                Product(
                    id=f"D{pid:05d}",
                    title=title,
                    description=f"{title} — {subcat_name} category {brand}.",
                    category=category,
                    subcategories=[subcat_name],
                    tags=tags,
                    brand=brand,
                    price=round(rng.uniform(9.99, 299.99), 2),
                    currency="USD",
                    popularity_score=round(rng.uniform(0.20, 0.95), 3),
                    freshness_score=round(rng.uniform(0.10, 0.90), 3),
                    image_url="",
                    url="",
                    attributes={},
                )
            )
            pid += 1
    return products


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    products = generate_products()
    products_path = OUT_DIR / "products.jsonl"
    with products_path.open("w", encoding="utf-8") as f:
        for p in products:
            f.write(p.model_dump_json() + "\n")

    checksum = "sha256:" + hashlib.sha256(products_path.read_bytes()).hexdigest()
    manifest = CatalogManifest(
        catalog_id="edgereco-demo",
        version="2026-04-30T00:00:00Z",
        embedding_model="sentence-transformers/all-MiniLM-L6-v2",
        embedding_dim=384,
        files=[CatalogFile(
            path="products.jsonl",
            file_type="products",
            checksum=checksum,
            rows=len(products),
        )],
    )
    (OUT_DIR / "manifest.json").write_text(
        manifest.model_dump_json(indent=2),
        encoding="utf-8",
    )
    print(f"Wrote {len(products)} products to {products_path}")
    print(f"Manifest checksum: {checksum}")


if __name__ == "__main__":
    main()
