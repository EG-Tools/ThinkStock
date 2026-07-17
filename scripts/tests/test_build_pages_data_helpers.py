from __future__ import annotations

import sys
import unittest
from pathlib import Path

import pandas as pd


SCRIPTS_DIR = Path(__file__).resolve().parents[1]
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from build_pages_data import (
    CREDIT_SERIES,
    build_dart_corp_code_payload,
    find_credit_history_discontinuity,
    merge_credit_seed_with_kofia,
)


class BuildPagesDataHelperTests(unittest.TestCase):
    def test_dart_corp_payload_contains_only_compact_code_mapping(self) -> None:
        payload = build_dart_corp_code_payload({
            "005930": {"corp_code": "00126380", "corp_name": "Samsung Electronics"},
            "218410": {"corp_code": "01035674", "corp_name": "RFHIC"},
        })

        self.assertEqual(payload["format"], "stock-to-corp-v2")
        self.assertEqual(payload["total"], 2)
        self.assertEqual(payload["codes"]["005930"], "00126380")
        self.assertNotIn("records", payload)
        self.assertNotIn("Samsung Electronics", str(payload))

    def test_kofia_merge_preserves_overlap_and_scales_only_new_tail(self) -> None:
        seed_dates = pd.to_datetime([
            "2026-01-01",
            "2026-01-02",
            "2026-01-03",
            "2026-01-04",
            "2026-01-05",
            "2026-01-06",
        ])
        seed = pd.DataFrame({
            "customer_deposit": [60, 61, 62, 63, 64, 65],
            "kospi_credit": [20, 20.2, 20.4, 20.6, 20.8, 21],
            "kosdaq_credit": [10, 10.1, 10.2, 10.3, 10.4, 10.5],
        }, index=seed_dates)
        seed.index.name = "date"
        live = pd.DataFrame({
            "customer_deposit": [30.5, 31, 31.5, 32, 32.5, 33],
            "kospi_credit": [10.1, 10.2, 10.3, 10.4, 10.5, 10.6],
            "kosdaq_credit": [5.05, 5.1, 5.15, 5.2, 5.25, 5.3],
        }, index=pd.to_datetime([
            "2026-01-02",
            "2026-01-03",
            "2026-01-04",
            "2026-01-05",
            "2026-01-06",
            "2026-01-07",
        ]))
        live.index.name = "date"

        merged, applied = merge_credit_seed_with_kofia(seed, live)

        self.assertEqual(applied, 1)
        pd.testing.assert_frame_equal(
            merged.loc[seed.index, CREDIT_SERIES],
            seed[CREDIT_SERIES],
            check_dtype=False,
        )
        self.assertAlmostEqual(float(merged.loc[pd.Timestamp("2026-01-07"), "kospi_credit"]), 21.2)
        self.assertAlmostEqual(float(merged.loc[pd.Timestamp("2026-01-07"), "kosdaq_credit"]), 10.6)

    def test_kofia_merge_rejects_discontinuous_tail_without_overlap(self) -> None:
        seed = pd.DataFrame({
            "customer_deposit": [60.0],
            "kospi_credit": [20.0],
            "kosdaq_credit": [10.0],
        }, index=pd.to_datetime(["2026-01-01"]))
        live = pd.DataFrame({
            "customer_deposit": [30.0],
            "kospi_credit": [5.0],
            "kosdaq_credit": [2.0],
        }, index=pd.to_datetime(["2026-01-02"]))

        merged, applied = merge_credit_seed_with_kofia(seed, live)

        self.assertEqual(applied, 0)
        pd.testing.assert_frame_equal(
            merged[CREDIT_SERIES],
            seed[CREDIT_SERIES],
            check_names=False,
        )

    def test_detects_poisoned_cached_credit_history(self) -> None:
        frame = pd.DataFrame({
            "customer_deposit": [60.0, 60.5],
            "kospi_credit": [17.72, 14.079],
            "kosdaq_credit": [10.0, 10.1],
        }, index=pd.to_datetime(["2025-10-01", "2025-10-02"]))

        issue = find_credit_history_discontinuity(frame)

        self.assertIn("kospi_credit", issue)
        self.assertIn("2025-10-01->2025-10-02", issue)


if __name__ == "__main__":
    unittest.main()
