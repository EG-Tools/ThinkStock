from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from build_reporting import (
    detect_output_anomalies,
    payload_file_summary,
    summarize_build_trend,
    write_report_with_history,
)


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

    def test_payload_summary_keeps_latest_numeric_values(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "payload.json"
            path.write_text(json.dumps({
                "dates": ["2026-01-01", "2026-01-02"],
                "columns": {"leading_cycle": [100.0, 101.5]},
            }), encoding="utf-8")

            summary = payload_file_summary(path)

        self.assertEqual(summary["series_latest_values"]["leading_cycle"], 101.5)

    def test_output_anomalies_detect_regression_drop_and_value_jump(self) -> None:
        previous_runs = [{
            "outputs": {
                "macro": {
                    "rows": 100,
                    "latest": "2026-05-01",
                    "series_points": {"leading_cycle": 100},
                    "series_latest_values": {"leading_cycle": 100.0},
                },
            },
        }]
        report = {
            "outputs": {
                "macro": {
                    "rows": 70,
                    "latest": "2026-04-01",
                    "series_points": {"leading_cycle": 70},
                    "series_latest_values": {"leading_cycle": 110.0},
                },
            },
        }

        warnings = detect_output_anomalies(report, previous_runs)

        self.assertTrue(any("latest regressed" in warning for warning in warnings))
        self.assertTrue(any("rows dropped" in warning for warning in warnings))
        self.assertTrue(any("points dropped" in warning for warning in warnings))
        self.assertTrue(any("latest value changed" in warning for warning in warnings))


if __name__ == "__main__":
    unittest.main()
