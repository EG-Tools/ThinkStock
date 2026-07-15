from __future__ import annotations

import sys
import unittest
from pathlib import Path

import pandas as pd


SCRIPTS_DIR = Path(__file__).resolve().parents[1]
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from macro_utils import densify_macro


class MacroUtilsTests(unittest.TestCase):
    def test_month_start_holiday_keeps_latest_value_through_month(self) -> None:
        macro = pd.DataFrame(
            {"leading_cycle": [104.1, 104.8]},
            index=pd.to_datetime(["2026-04-01", "2026-05-01"]),
        )
        prices = pd.to_datetime(["2026-04-30", "2026-05-04", "2026-05-29", "2026-06-01"])

        dense = densify_macro(macro, prices)

        self.assertEqual(dense.index.max(), pd.Timestamp("2026-05-29"))
        self.assertEqual(dense.loc[pd.Timestamp("2026-05-04"), "leading_cycle"], 104.8)
        self.assertEqual(dense.loc[pd.Timestamp("2026-05-29"), "leading_cycle"], 104.8)
        self.assertNotIn(pd.Timestamp("2026-06-01"), dense.index)

    def test_daily_endpoint_is_not_extended(self) -> None:
        macro = pd.DataFrame(
            {"leading_cycle": [103.5, 104.1]},
            index=pd.to_datetime(["2026-03-31", "2026-04-30"]),
        )
        prices = pd.to_datetime(["2026-04-30", "2026-05-04"])

        dense = densify_macro(macro, prices)

        self.assertEqual(dense.index.tolist(), [pd.Timestamp("2026-04-30")])
        self.assertEqual(dense.iloc[0]["leading_cycle"], 104.1)

    def test_each_series_uses_its_own_latest_observation(self) -> None:
        macro = pd.DataFrame(
            {
                "leading_cycle": [104.1, 104.8, None],
                "news_sentiment": [None, 101.0, 103.0],
            },
            index=pd.to_datetime(["2026-04-01", "2026-05-01", "2026-07-12"]),
        )
        prices = pd.date_range("2026-04-01", "2026-07-14", freq="B")

        dense = densify_macro(macro, prices)

        self.assertEqual(dense.loc[pd.Timestamp("2026-05-29"), "leading_cycle"], 104.8)
        self.assertTrue(pd.isna(dense.loc[pd.Timestamp("2026-06-01"), "leading_cycle"]))
        self.assertGreater(dense.loc[pd.Timestamp("2026-07-10"), "news_sentiment"], 102.9)
        self.assertEqual(dense.loc[pd.Timestamp("2026-07-13"), "news_sentiment"], 103.0)

    def test_weekend_news_sentiment_rolls_to_next_market_day_only(self) -> None:
        macro = pd.DataFrame(
            {"news_sentiment": [110.72, 111.32, 110.34]},
            index=pd.to_datetime(["2026-07-10", "2026-07-11", "2026-07-12"]),
        )
        prices = pd.to_datetime(["2026-07-10", "2026-07-13", "2026-07-14"])

        dense = densify_macro(macro, prices)

        self.assertEqual(dense.index.max(), pd.Timestamp("2026-07-13"))
        self.assertEqual(dense.loc[pd.Timestamp("2026-07-13"), "news_sentiment"], 110.34)
        self.assertNotIn(pd.Timestamp("2026-07-14"), dense.index)
