from __future__ import annotations

import json
import shutil
from pathlib import Path

from split_pages_data import MANIFEST_FILE, SEGMENTED_FILES


ROOT = Path(__file__).resolve().parents[1]
SOURCE_DIR = ROOT / "docs"
TARGET_DIR = ROOT / ".pages-artifact"


def prepare_pages_artifact(source_dir: Path, target_dir: Path) -> list[str]:
    source = source_dir.resolve()
    target = target_dir.resolve()
    if source == target or source in target.parents or target.parent != source.parent:
        raise ValueError("artifact target must be a sibling of the source directory")

    data_dir = source / "data"
    manifest_path = data_dir / MANIFEST_FILE
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    datasets = manifest.get("datasets")
    if manifest.get("format") != "segmented-data-v1" or not isinstance(datasets, dict):
        raise ValueError("segmented data manifest is invalid")

    for filename in SEGMENTED_FILES:
        stem = Path(filename).stem
        dataset = datasets.get(stem)
        if not isinstance(dataset, dict):
            raise ValueError(f"manifest is missing {stem}")
        for segment_name in ("recent", "history"):
            segment = dataset.get(segment_name)
            segment_file = segment.get("file") if isinstance(segment, dict) else ""
            segment_path = data_dir / str(segment_file)
            if not segment_path.is_file():
                raise ValueError(f"manifest segment is missing: {segment_file}")

    if target.exists():
        shutil.rmtree(target)
    shutil.copytree(source, target)

    removed: list[str] = []
    for filename in SEGMENTED_FILES:
        redundant = target / "data" / filename
        if redundant.exists():
            redundant.unlink()
            removed.append(filename)
    return removed


def main() -> int:
    removed = prepare_pages_artifact(SOURCE_DIR, TARGET_DIR)
    print(f"Prepared {TARGET_DIR} without {', '.join(removed)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
