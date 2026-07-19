from __future__ import annotations

import sys
import unittest
from pathlib import Path

import pandas as pd


SCRIPTS_DIR = Path(__file__).resolve().parents[1]
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from disclosure_processing import normalize_disclosure_records
from payload_output import build_payload, records_from_payload, records_to_frame


class ProcessingModuleTests(unittest.TestCase):
    def test_columnar_payload_round_trip_preserves_dates_and_values(self) -> None:
        frame = pd.DataFrame(
            {"value": [1.25, 2.5]},
            index=pd.to_datetime(["2026-07-01", "2026-07-02"]),
        )
        frame.index.name = "date"

        payload = build_payload(frame, {"value": "Value"}, ["value"])
        records = records_from_payload(payload)
        restored = records_to_frame(records, ["value"])

        self.assertEqual(payload["format"], "columnar-v1")
        self.assertEqual(records[-1], {"date": "2026-07-02", "value": 2.5})
        self.assertEqual(float(restored.iloc[-1]["value"]), 2.5)

    def test_disclosure_processing_keeps_market_moving_events_only(self) -> None:
        records = normalize_disclosure_records([
            {
                "ticker": "005930.KS",
                "date": "2026-07-01",
                "title": "단일판매ㆍ공급계약체결",
            },
            {
                "ticker": "005930.KS",
                "date": "2026-07-02",
                "title": "기업설명회(IR) 개최",
            },
        ])

        self.assertEqual(len(records), 1)
        self.assertEqual(records[0]["type"], "수주")


if __name__ == "__main__":
    unittest.main()
