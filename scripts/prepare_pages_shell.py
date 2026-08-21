from __future__ import annotations

import shutil
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SOURCE_DIR = ROOT / "docs"
TARGET_DIR = ROOT / "pages-shell"
REQUIRED_FILES = (
    "index.html",
    "styles.css",
    "sw.js",
    "assets/app.bundle.min.js",
    "assets/ai-feature.bundle.min.js",
    "assets/market-timing-feature.bundle.min.js",
    "assets/stock-research-feature.bundle.min.js",
    "assets/settings-feature.bundle.min.js",
)


def prepare_pages_shell(source_dir: Path, target_dir: Path) -> int:
    source = source_dir.resolve()
    target = target_dir.resolve()
    if source == target or source in target.parents or target.parent != source.parent:
        raise ValueError("shell target must be a sibling of the source directory")
    missing = [name for name in REQUIRED_FILES if not (source / name).is_file()]
    if missing:
        raise ValueError(f"Pages shell is incomplete: {', '.join(missing)}")
    if target.exists():
        shutil.rmtree(target)
    shutil.copytree(source, target, ignore=shutil.ignore_patterns("data"))
    return sum(path.stat().st_size for path in target.rglob("*") if path.is_file())


def main() -> int:
    size = prepare_pages_shell(SOURCE_DIR, TARGET_DIR)
    print(f"Prepared {TARGET_DIR} without data ({size} bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
