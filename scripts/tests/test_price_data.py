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

from build_pages_data import DEFAULT_TICKERS, merge_price_seed_with_live


class PriceDataTests(unittest.TestCase):
    def test_live_values_replace_history_while_newer_seed_tail_is_preserved(self) -> None:
        dates = pd.to_datetime(["2026-07-14", "2026-07-15", "2026-07-16"])
        seed = pd.DataFrame(
            {
                DEFAULT_TICKERS[0]: [3100.0, 3120.0, 3140.0],
                DEFAULT_TICKERS[1]: [800.0, 810.0, 820.0],
            },
            index=dates,
        )
        live = pd.DataFrame(
            {
                DEFAULT_TICKERS[0]: [1550.0, 1560.0],
                DEFAULT_TICKERS[1]: [805.0, 815.0],
            },
            index=dates[:2],
        )

        merged = merge_price_seed_with_live(seed, live)

        self.assertEqual(merged.loc[dates[0], DEFAULT_TICKERS[0]], 1550.0)
        self.assertEqual(merged.loc[dates[2], DEFAULT_TICKERS[0]], 3140.0)
        self.assertEqual(merged.loc[dates[2], DEFAULT_TICKERS[1]], 820.0)

    def test_live_missing_one_ticker_keeps_only_that_tickers_cached_values(self) -> None:
        dates = pd.to_datetime(["2026-07-15", "2026-07-16"])
        seed = pd.DataFrame({DEFAULT_TICKERS[0]: [3120.0, 3140.0]}, index=dates)
        live = pd.DataFrame(
            {
                DEFAULT_TICKERS[0]: [3130.0, None],
                DEFAULT_TICKERS[1]: [810.0, 825.0],
            },
            index=dates,
        )

        merged = merge_price_seed_with_live(seed, live)

        self.assertEqual(merged.loc[dates[0], DEFAULT_TICKERS[0]], 3130.0)
        self.assertEqual(merged.loc[dates[1], DEFAULT_TICKERS[0]], 3140.0)
        self.assertEqual(merged.loc[dates[1], DEFAULT_TICKERS[1]], 825.0)


if __name__ == "__main__":
    unittest.main()
