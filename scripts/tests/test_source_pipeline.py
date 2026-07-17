from __future__ import annotations

import unittest

from source_pipeline import SourcePipeline


class SourcePipelineTests(unittest.TestCase):
    def test_records_successful_provider_health(self) -> None:
        report = {}
        pipeline = SourcePipeline(report)
        value = pipeline.run(
            "sample",
            lambda: [{"date": "2026-01-01"}],
            lambda rows: {"rows": len(rows), "latest": rows[-1]["date"]},
        )

        self.assertEqual(len(value), 1)
        self.assertEqual(report["sources"]["sample"]["status"], "ok")
        self.assertIn("duration_ms", report["sources"]["sample"])

    def test_can_degrade_optional_provider_without_stopping_build(self) -> None:
        report = {}
        pipeline = SourcePipeline(report)
        value = pipeline.run(
            "optional",
            lambda: (_ for _ in ()).throw(RuntimeError("provider unavailable")),
            lambda rows: {"rows": len(rows), "latest": ""},
            allow_failure=True,
            default=[],
        )

        self.assertEqual(value, [])
        self.assertEqual(report["sources"]["optional"]["status"], "error")
        self.assertIn("optional failed", report["events"][0])


if __name__ == "__main__":
    unittest.main()
