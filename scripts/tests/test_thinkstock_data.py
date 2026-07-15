import json
import tempfile
import unittest
from pathlib import Path

from thinkstock_data import (
    bundled_data_revision,
    columnar_payload_to_frame,
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


if __name__ == "__main__":
    unittest.main()
