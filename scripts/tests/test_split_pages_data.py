from __future__ import annotations

import sys
import json
import tempfile
import unittest
from pathlib import Path


SCRIPTS_DIR = Path(__file__).resolve().parents[1]
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from split_pages_data import MANIFEST_FILE, SEGMENTED_FILES, split_all_payloads, split_columnar_payload


class SplitPagesDataTests(unittest.TestCase):
    def test_splits_columns_at_recent_cutoff(self) -> None:
        payload = {
            "format": "columnar-v1",
            "series": ["value"],
            "dates": ["2014-01-01", "2015-01-01", "2025-01-01", "2026-01-01"],
            "columns": {"value": [1, 2, 3, 4]},
        }

        recent, history = split_columnar_payload(payload, recent_years=11)

        self.assertEqual(history["dates"], ["2014-01-01"])
        self.assertEqual(history["columns"]["value"], [1])
        self.assertEqual(recent["dates"], ["2015-01-01", "2025-01-01", "2026-01-01"])
        self.assertEqual(recent["columns"]["value"], [2, 3, 4])
        self.assertEqual(recent["cutoff"], "2015-01-01")

    def test_empty_payload_stays_valid(self) -> None:
        recent, history = split_columnar_payload({"series": ["value"], "dates": [], "columns": {"value": []}})
        self.assertEqual(recent["dates"], [])
        self.assertEqual(history["columns"]["value"], [])

    def test_split_writes_hashed_manifest(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            data_dir = Path(temp_dir)
            for filename in SEGMENTED_FILES:
                (data_dir / filename).write_text(
                    json.dumps({
                        "dates": ["2014-01-01", "2026-01-01"],
                        "columns": {"value": [1, 2]},
                    }),
                    encoding="utf-8",
                )

            split_all_payloads(data_dir)

            manifest = json.loads((data_dir / MANIFEST_FILE).read_text(encoding="utf-8"))
            self.assertEqual(manifest["format"], "segmented-data-v1")
            self.assertEqual(manifest["datasets"]["prices"]["recent"]["rows"], 1)
            self.assertEqual(len(manifest["datasets"]["prices"]["recent"]["sha256"]), 64)
            self.assertEqual(len(manifest["revision"]), 24)


if __name__ == "__main__":
    unittest.main()
