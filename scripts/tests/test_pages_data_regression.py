from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path


SCRIPTS_DIR = Path(__file__).resolve().parents[1]
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from check_pages_data_regression import DataRegressionError, compare_core_dataset


def write_payload(root: Path, file_name: str, dates: list[str], values: list[float | None]) -> Path:
    path = root / file_name
    path.write_text(
        json.dumps({"dates": dates, "series": ["sample"], "columns": {"sample": values}}),
        encoding="utf-8",
    )
    return path


class PagesDataRegressionTests(unittest.TestCase):
    def test_allows_newer_data(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            baseline = write_payload(root, "baseline.json", ["2026-01-01", "2026-01-02"], [1, 2])
            current = write_payload(root, "current.json", ["2026-01-01", "2026-01-02", "2026-01-03"], [1, 2, 3])
            messages = compare_core_dataset("sample", baseline, current)
            self.assertEqual(len(messages), 1)

    def test_rejects_latest_date_regression(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            baseline = write_payload(root, "baseline.json", ["2026-01-01", "2026-01-02"], [1, 2])
            current = write_payload(root, "current.json", ["2026-01-01"], [1])
            with self.assertRaisesRegex(DataRegressionError, "latest date regressed"):
                compare_core_dataset("sample", baseline, current)

    def test_rejects_lost_history(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            baseline = write_payload(root, "baseline.json", ["2025-01-01", "2026-01-01"], [1, 2])
            current = write_payload(root, "current.json", ["2026-01-01", "2026-01-02"], [2, 3])
            with self.assertRaisesRegex(DataRegressionError, "history starts later"):
                compare_core_dataset("sample", baseline, current)


if __name__ == "__main__":
    unittest.main()
