from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from build_reporting import summarize_build_trend, write_report_with_history


class BuildReportingTests(unittest.TestCase):
    def test_report_history_is_bounded_and_exposes_trend(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            report_path = root / "build_report.json"
            history_path = root / "build_history.json"

            for index in range(25):
                report = {
                    "generated_at": f"2026-01-{index + 1:02d}T00:00:00Z",
                    "mode": "incremental",
                    "sources": {},
                    "health": {
                        "total_duration_ms": 1000 + index,
                        "warnings": [],
                        "http": {"requests": 2, "retries": 0, "failures": 0},
                    },
                }
                write_report_with_history(report, report_path, history_path)

            history = json.loads(history_path.read_text(encoding="utf-8"))
            latest = json.loads(report_path.read_text(encoding="utf-8"))
            self.assertEqual(len(history["runs"]), 20)
            self.assertEqual(latest["health"]["trend"]["window"], 10)
            self.assertEqual(latest["health"]["trend"]["healthy_rate_pct"], 100.0)

    def test_trend_compares_latest_duration_with_median(self) -> None:
        trend = summarize_build_trend([
            {"duration_ms": 100, "warnings": 0, "http": {}},
            {"duration_ms": 100, "warnings": 0, "http": {}},
            {"duration_ms": 200, "warnings": 1, "http": {"failures": 0}},
        ])
        self.assertEqual(trend["median_duration_ms"], 100)
        self.assertEqual(trend["duration_vs_median_pct"], 100.0)
        self.assertEqual(trend["healthy_runs"], 2)


if __name__ == "__main__":
    unittest.main()
