from __future__ import annotations

import json
import os
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path
from unittest.mock import patch


SCRIPTS_DIR = Path(__file__).resolve().parents[1]
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from check_pages_data_regression import (
    DataRegressionError,
    compare_core_dataset,
    compare_corp_codes,
    emit_github_error,
)


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

    def test_emits_actionable_github_annotation(self) -> None:
        output = StringIO()
        with patch.dict(os.environ, {"GITHUB_ACTIONS": "true"}), redirect_stdout(output):
            emit_github_error("prices: latest regressed\n2026-07-16 -> 2026-07-15")

        self.assertIn("file=scripts/check_pages_data_regression.py,line=1", output.getvalue())
        self.assertIn("%0A", output.getvalue())

    def test_compares_legacy_and_compact_dart_code_formats(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            baseline = root / "baseline"
            current = root / "current"
            baseline.mkdir()
            current.mkdir()
            (baseline / "dart_corp_codes.json").write_text(
                json.dumps({
                    "records": [
                        {"stock_code": "005930", "corp_code": "00126380", "corp_name": "Samsung"},
                        {"stock_code": "218410", "corp_code": "01035674", "corp_name": "RFHIC"},
                    ],
                }),
                encoding="utf-8",
            )
            (current / "dart_corp_codes.json").write_text(
                json.dumps({
                    "format": "stock-to-corp-v2",
                    "codes": {
                        "005930": "00126380",
                        "218410": "01035674",
                    },
                }),
                encoding="utf-8",
            )

            self.assertEqual(compare_corp_codes(baseline, current), "dart_corp_codes: 2 mappings")

    def test_compares_legacy_and_sharded_dart_code_formats(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            baseline = root / "baseline"
            current = root / "current"
            baseline.mkdir()
            (current / "dart_corp_codes").mkdir(parents=True)
            codes = {
                "005930": "00126380",
                "218410": "01035674",
            }
            (baseline / "dart_corp_codes.json").write_text(
                json.dumps({"format": "stock-to-corp-v2", "codes": codes}),
                encoding="utf-8",
            )
            (current / "dart_corp_codes.json").write_text(
                json.dumps({
                    "format": "stock-to-corp-shards-v1",
                    "files": {
                        "00": "data/dart_corp_codes/00.json",
                        "21": "data/dart_corp_codes/21.json",
                    },
                }),
                encoding="utf-8",
            )
            (current / "dart_corp_codes" / "00.json").write_text(
                json.dumps({"format": "stock-to-corp-shard-v1", "codes": {"005930": "00126380"}}),
                encoding="utf-8",
            )
            (current / "dart_corp_codes" / "21.json").write_text(
                json.dumps({"format": "stock-to-corp-shard-v1", "codes": {"218410": "01035674"}}),
                encoding="utf-8",
            )

            self.assertEqual(compare_corp_codes(baseline, current), "dart_corp_codes: 2 mappings")


if __name__ == "__main__":
    unittest.main()
