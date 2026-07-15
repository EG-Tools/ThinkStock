from __future__ import annotations

import sys
import types
import unittest
from pathlib import Path

import pandas as pd


SCRIPTS_DIR = Path(__file__).resolve().parents[1]
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

# The merge helpers do not use network clients; lightweight stubs keep this
# regression test runnable in the bundled offline Python environment.
sys.modules.setdefault("requests", types.ModuleType("requests"))
sys.modules.setdefault("yfinance", types.ModuleType("yfinance"))

from build_pages_data import AUXILIARY_SERIES, merge_auxiliary_data


class AuxiliaryDataTests(unittest.TestCase):
    def test_fear_greed_dates_are_merged_without_dropping_adr(self) -> None:
        seed = pd.DataFrame(
            {"adr_kospi": [101.0], "adr_kosdaq": [98.0], "fear_greed": [None]},
            index=pd.to_datetime(["2026-07-13"]),
        )
        fear_rows = [
            {"date": "2026-07-12", "fear_greed": 22},
            {"date": "2026-07-14", "fear_greed": 25},
        ]

        merged = merge_auxiliary_data(seed, fear_rows, ["fear_greed"])

        self.assertEqual(list(merged.columns), AUXILIARY_SERIES)
        self.assertEqual(merged.index.tolist(), list(pd.to_datetime(["2026-07-12", "2026-07-13", "2026-07-14"])))
        self.assertEqual(merged.loc[pd.Timestamp("2026-07-13"), "adr_kospi"], 101.0)
        self.assertEqual(merged.loc[pd.Timestamp("2026-07-14"), "fear_greed"], 25.0)


if __name__ == "__main__":
    unittest.main()
