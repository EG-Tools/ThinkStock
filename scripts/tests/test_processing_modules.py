from __future__ import annotations

import sys
import unittest
from pathlib import Path

import pandas as pd


SCRIPTS_DIR = Path(__file__).resolve().parents[1]
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from disclosure_processing import (
    add_krx_preferred_share_aliases,
    normalize_dart_company_name,
    normalize_disclosure_records,
)
from payload_output import build_payload, records_from_payload, records_to_frame


class ProcessingModuleTests(unittest.TestCase):
    def test_dart_company_names_normalize_spac_and_corporate_suffixes(self) -> None:
        self.assertEqual(
            normalize_dart_company_name("주식회사 미래에셋비전기업인수목적8호"),
            normalize_dart_company_name("미래에셋비전스팩8호"),
        )
        self.assertEqual(
            normalize_dart_company_name("삼성전자(주)"),
            normalize_dart_company_name("삼성전자"),
        )

    def test_preferred_shares_reuse_the_issuer_dart_corp_code(self) -> None:
        corp_map = {
            "005930": {"corp_code": "00126380", "corp_name": "삼성전자"},
            "001040": {"corp_code": "00148540", "corp_name": "CJ"},
            "007810": {"corp_code": "00123456", "corp_name": "코리아써키트"},
        }
        records = [
            {"ticker": "005930.KS", "code": "005930", "name": "삼성전자", "market": "KOSPI"},
            {"ticker": "005935.KS", "code": "005935", "name": "삼성전자우", "market": "KOSPI"},
            {"ticker": "001040.KS", "code": "001040", "name": "CJ", "market": "KOSPI"},
            {"ticker": "000104.KS", "code": "000104", "name": "CJ4우(전환)", "market": "KOSPI"},
            {"ticker": "007810.KS", "code": "007810", "name": "코리아써키트", "market": "KOSPI"},
            {"ticker": "007815.KS", "code": "007815", "name": "코리아써우", "market": "KOSPI"},
            {"ticker": "000710.KQ", "code": "000710", "name": "삼성스팩11호", "market": "KOSDAQ"},
        ]

        expanded = add_krx_preferred_share_aliases(corp_map, records)

        self.assertEqual(expanded["005935"]["corp_code"], "00126380")
        self.assertEqual(expanded["000104"]["corp_code"], "00148540")
        self.assertEqual(expanded["007815"]["corp_code"], "00123456")
        self.assertNotIn("000710", expanded)

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
