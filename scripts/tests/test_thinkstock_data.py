import json
import tempfile
import unittest
from datetime import date
from pathlib import Path

import pandas as pd

from thinkstock_data import (
    bundled_data_revision,
    columnar_payload_to_frame,
    extract_close_series,
    fetch_prices,
    load_bundled_market_data,
)


def payload(dates, columns):
    return {
        "format": "columnar-v1",
        "dates": dates,
        "columns": columns,
    }


class ThinkStockDataTests(unittest.TestCase):
    def test_load_bundled_market_data_merges_macro_and_credit(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            data_dir = Path(temp_dir)
            (data_dir / "macro_data.json").write_text(
                json.dumps(payload(["2026-01-01", "2026-01-02"], {"leading_cycle": [99.5, 100.1]})),
                encoding="utf-8",
            )
            (data_dir / "credit_data.json").write_text(
                json.dumps(payload(
                    ["2026-01-02", "2026-01-03"],
                    {
                        "customer_deposit": [75.2, 76.1],
                        "kospi_credit": [12.3, 12.5],
                        "kosdaq_credit": [8.1, 8.2],
                    },
                )),
                encoding="utf-8",
            )

            frame = load_bundled_market_data(data_dir)

            self.assertEqual(
                list(frame.columns),
                ["date", "leading_cycle", "customer_deposit", "kospi_credit", "kosdaq_credit"],
            )
            self.assertEqual(frame["date"].dt.strftime("%Y-%m-%d").tolist(), ["2026-01-01", "2026-01-02", "2026-01-03"])
            self.assertEqual(frame.loc[1, "customer_deposit"], 75.2)
            self.assertEqual(len(bundled_data_revision(data_dir)), 2)

    def test_columnar_payload_rejects_mismatched_lengths(self):
        with self.assertRaisesRegex(ValueError, "length mismatch"):
            columnar_payload_to_frame(payload(["2026-01-01"], {"leading_cycle": [99.5, 100.1]}))

    def test_fetch_prices_uses_one_parallel_batch_when_all_tickers_exist(self):
        calls = []
        index = pd.to_datetime(["2026-01-02", "2026-01-05"])
        batch = pd.DataFrame(
            [[100.0, 200.0], [101.0, 202.0]],
            index=index,
            columns=pd.MultiIndex.from_tuples([("Close", "AAA"), ("Close", "BBB")]),
        )

        def fake_download(tickers, **kwargs):
            calls.append((tickers, kwargs))
            return batch

        frame, success, failures = fetch_prices(
            ("AAA", "BBB"),
            date(2026, 1, 1),
            date(2026, 1, 5),
            download_fn=fake_download,
        )

        self.assertEqual(success, ["AAA", "BBB"])
        self.assertEqual(failures, {})
        self.assertEqual(list(frame.columns), ["AAA", "BBB"])
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0][0], ["AAA", "BBB"])
        self.assertTrue(calls[0][1]["threads"])

    def test_fetch_prices_retries_only_a_ticker_missing_from_batch(self):
        calls = []
        index = pd.to_datetime(["2026-01-02", "2026-01-05"])
        batch = pd.DataFrame(
            [[100.0], [101.0]],
            index=index,
            columns=pd.MultiIndex.from_tuples([("Close", "AAA")]),
        )
        retry = pd.DataFrame({"Close": [200.0, 202.0]}, index=index)

        def fake_download(tickers, **kwargs):
            calls.append((tickers, kwargs))
            return batch if isinstance(tickers, list) else retry

        frame, success, failures = fetch_prices(
            ("AAA", "BBB"),
            date(2026, 1, 1),
            date(2026, 1, 5),
            download_fn=fake_download,
        )

        self.assertEqual(success, ["AAA", "BBB"])
        self.assertEqual(failures, {})
        self.assertEqual(len(calls), 2)
        self.assertEqual(calls[1][0], "BBB")
        self.assertFalse(calls[1][1]["threads"])
        self.assertEqual(frame.loc[index[-1], "BBB"], 202.0)

    def test_extract_close_series_supports_ticker_first_columns(self):
        data = pd.DataFrame(
            [[300.0]],
            index=pd.to_datetime(["2026-01-02"]),
            columns=pd.MultiIndex.from_tuples([("AAA", "Close")]),
        )

        series = extract_close_series(data, "AAA")

        self.assertIsNotNone(series)
        self.assertEqual(series.iloc[0], 300.0)


if __name__ == "__main__":
    unittest.main()
