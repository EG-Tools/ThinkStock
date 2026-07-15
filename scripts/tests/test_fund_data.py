from __future__ import annotations

import sys
import types
import unittest
from pathlib import Path

import pandas as pd


SCRIPTS_DIR = Path(__file__).resolve().parents[1]
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

for optional_module in ("requests", "yfinance"):
    if optional_module not in sys.modules:
        try:
            __import__(optional_module)
        except ModuleNotFoundError:
            sys.modules[optional_module] = types.ModuleType(optional_module)

from build_pages_data import CREDIT_SERIES, _credit_frame_from_records, merge_credit_frames


class FundDataTests(unittest.TestCase):
    def test_normalizes_customer_deposit_with_credit(self) -> None:
        frame = _credit_frame_from_records([
            {
                "date": "2026-07-13",
                "customer_deposit": 109.0116,
                "kospi_credit": 27.4472,
                "kosdaq_credit": 7.3415,
            },
        ])

        self.assertEqual(list(frame.columns), CREDIT_SERIES)
        self.assertEqual(frame.index.size, 1)
        self.assertAlmostEqual(float(frame.iloc[0]["customer_deposit"]), 109.0116)
        self.assertAlmostEqual(float(frame.iloc[0]["kospi_credit"]), 27.4472)

    def test_merge_preserves_non_null_values_from_both_sources(self) -> None:
        index = pd.to_datetime(["2026-07-13"])
        credit = pd.DataFrame(
            {"kospi_credit": [27.4472], "kosdaq_credit": [7.3415]},
            index=index,
        )
        deposit = pd.DataFrame({"customer_deposit": [109.0116]}, index=index)

        merged = merge_credit_frames(credit, deposit)

        self.assertEqual(merged.index.size, 1)
        self.assertAlmostEqual(float(merged.iloc[0]["customer_deposit"]), 109.0116)
        self.assertAlmostEqual(float(merged.iloc[0]["kosdaq_credit"]), 7.3415)


if __name__ == "__main__":
    unittest.main()
