from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest.mock import patch

import pandas as pd


SCRIPTS_DIR = Path(__file__).resolve().parents[1]
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from build_pages_data import (
    CREDIT_SERIES,
    accepted_credit_series_tail,
    build_dart_corp_code_payload,
    build_dart_corp_code_payloads,
    find_credit_history_discontinuity,
    normalize_krx_universe_rows,
    merge_credit_seed_with_freesis,
    merge_credit_seed_with_kofia,
    select_credit_seed,
)
import build_pages_data


class BuildPagesDataHelperTests(unittest.TestCase):
    def test_ecos_contract_failure_preserves_expected_series(self) -> None:
        client = type("Client", (), {"get_json": lambda *_args, **_kwargs: {"unexpected": {}}})()
        with patch.object(build_pages_data, "http_client", return_value=client):
            leading = build_pages_data.fetch_ecos_leading_cycle("key")
            news = build_pages_data.fetch_ecos_news_sentiment("key")

        self.assertEqual(list(leading.columns), ["leading_cycle"])
        self.assertEqual(list(news.columns), ["news_sentiment"])

    def test_kosis_leading_cycle_normalizes_monthly_rows(self) -> None:
        client = type("Client", (), {"get_json": lambda *_args, **_kwargs: [
            {"PRD_DE": "202604", "DT": "102.8"},
            {"PRD_DE": "202605", "DT": "104.8"},
        ]})()
        with patch.object(build_pages_data, "http_client", return_value=client):
            leading = build_pages_data.fetch_kosis_leading_cycle("key", "202604")

        self.assertEqual(list(leading.columns), ["leading_cycle"])
        self.assertEqual(float(leading.loc[pd.Timestamp("2026-05-01"), "leading_cycle"]), 104.8)

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

    def test_dart_corp_payloads_are_sharded_by_stock_prefix(self) -> None:
        manifest, shards = build_dart_corp_code_payloads({
            "005930": {"corp_code": "00126380", "corp_name": "Samsung Electronics"},
            "218410": {"corp_code": "01035674", "corp_name": "RFHIC"},
        })

        self.assertEqual(manifest["format"], "stock-to-corp-shards-v1")
        self.assertEqual(manifest["files"]["00"], "data/dart_corp_codes/00.json")
        self.assertEqual(shards["00"]["codes"], {"005930": "00126380"})
        self.assertEqual(shards["21"]["codes"], {"218410": "01035674"})

    def test_krx_universe_rows_are_normalized_for_server_seed(self) -> None:
        records = normalize_krx_universe_rows([
            {"ISU_SRT_CD": "5930", "ISU_ABBRV": "삼성전자"},
            {"ISU_SRT_CD": "000660", "ISU_NM": "SK하이닉스"},
        ], "KOSPI")

        self.assertEqual(records, [
            {"ticker": "000660.KS", "code": "000660", "name": "SK하이닉스", "market": "KOSPI"},
            {"ticker": "005930.KS", "code": "005930", "name": "삼성전자", "market": "KOSPI"},
        ])

    def test_dart_market_disclosures_keep_only_important_stock_events(self) -> None:
        payload = {
            "status": "000",
            "message": "정상",
            "total_page": 1,
            "list": [
                {
                    "stock_code": "005930",
                    "corp_cls": "Y",
                    "corp_name": "삼성전자",
                    "report_nm": "현금ㆍ현물배당결정",
                    "rcept_dt": "20260718",
                    "rcept_no": "202607180001",
                },
                {
                    "stock_code": "005930",
                    "corp_cls": "Y",
                    "corp_name": "삼성전자",
                    "report_nm": "기업설명회(IR) 개최",
                    "rcept_dt": "20260718",
                    "rcept_no": "202607180002",
                },
            ],
        }
        client = type("Client", (), {"get_json": lambda *_args, **_kwargs: payload})()
        with patch.object(build_pages_data, "http_client", return_value=client):
            records = build_pages_data.fetch_dart_market_disclosures("key")

        self.assertEqual(len(records), 1)
        self.assertEqual(records[0]["ticker"], "005930.KS")
        self.assertEqual(records[0]["title"], "현금ㆍ현물배당결정")

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

    def test_incremental_freesis_merge_never_overwrites_verified_overlap(self) -> None:
        seed = pd.DataFrame({
            "customer_deposit": [60.0, 61.0, 62.0, 63.0, 64.0, 65.0],
            "kospi_credit": [17.72, 17.8, 17.9, 18.0, 18.1, 18.2],
            "kosdaq_credit": [9.0, 9.1, 9.2, 9.3, 9.4, 9.5],
        }, index=pd.to_datetime([
            "2025-10-01",
            "2025-10-02",
            "2025-10-03",
            "2025-10-04",
            "2025-10-05",
            "2025-10-06",
        ]))
        live = pd.DataFrame({
            "customer_deposit": [48.8, 49.6, 50.4, 51.2, 52.0, 52.8],
            "kospi_credit": [14.24, 14.32, 14.4, 14.48, 14.56, 14.64],
            "kosdaq_credit": [7.28, 7.36, 7.44, 7.52, 7.6, 7.68],
        }, index=pd.to_datetime([
            "2025-10-02",
            "2025-10-03",
            "2025-10-04",
            "2025-10-05",
            "2025-10-06",
            "2025-10-07",
        ]))

        merged, applied = merge_credit_seed_with_freesis(seed, live)

        self.assertEqual(applied, 1)
        self.assertAlmostEqual(float(merged.loc[pd.Timestamp("2025-10-02"), "kospi_credit"]), 17.8)
        self.assertGreater(float(merged.loc[pd.Timestamp("2025-10-07"), "kospi_credit"]), 18.0)

    def test_credit_quarantine_is_per_series_and_keeps_healthy_columns(self) -> None:
        seed = pd.DataFrame({
            "customer_deposit": [60.0],
            "kospi_credit": [18.0],
            "kosdaq_credit": [10.0],
        }, index=pd.to_datetime(["2026-07-14"]))
        live = pd.DataFrame({
            "customer_deposit": [61.0, 62.0],
            "kospi_credit": [4.0, 4.1],
            "kosdaq_credit": [10.1, 10.2],
        }, index=pd.to_datetime(["2026-07-15", "2026-07-16"]))
        events: list[str] = []

        merged, applied = merge_credit_seed_with_kofia(seed, live, events)

        self.assertEqual(applied, 2)
        self.assertTrue(pd.isna(merged.loc[pd.Timestamp("2026-07-16"), "kospi_credit"]))
        self.assertEqual(float(merged.loc[pd.Timestamp("2026-07-16"), "customer_deposit"]), 62.0)
        self.assertEqual(float(merged.loc[pd.Timestamp("2026-07-16"), "kosdaq_credit"]), 10.2)
        self.assertTrue(any("kospi_credit tail" in event for event in events))

    def test_credit_quarantine_skips_an_isolated_spike(self) -> None:
        accepted = accepted_credit_series_tail(
            "kospi_credit",
            pd.Series([18.0], index=pd.to_datetime(["2026-07-14"])),
            pd.Series([50.0, 18.2], index=pd.to_datetime(["2026-07-15", "2026-07-16"])),
            "fixture",
        )

        self.assertNotIn(pd.Timestamp("2026-07-15"), accepted.index)
        self.assertEqual(float(accepted.loc[pd.Timestamp("2026-07-16")]), 18.2)

    def test_detects_poisoned_cached_credit_history(self) -> None:
        frame = pd.DataFrame({
            "customer_deposit": [60.0, 60.5],
            "kospi_credit": [17.72, 14.079],
            "kosdaq_credit": [10.0, 10.1],
        }, index=pd.to_datetime(["2025-10-01", "2025-10-02"]))

        issue = find_credit_history_discontinuity(frame)

        self.assertIn("kospi_credit", issue)
        self.assertIn("2025-10-01->2025-10-02", issue)

    def test_verified_credit_seed_does_not_merge_rough_historical_rows(self) -> None:
        historical = pd.DataFrame({
            "customer_deposit": [1.0, 1.0],
            "kospi_credit": [0.6862, 3.75],
            "kosdaq_credit": [0.5, 0.5],
        }, index=pd.to_datetime(["1999-11-13", "1999-11-14"]))
        existing = pd.DataFrame({
            "customer_deposit": [60.0, 61.0],
            "kospi_credit": [17.0, 17.1],
            "kosdaq_credit": [9.0, 9.1],
        }, index=pd.to_datetime(["2026-07-14", "2026-07-15"]))

        selected = select_credit_seed(historical, existing)

        pd.testing.assert_frame_equal(selected, existing)
        self.assertNotIn(pd.Timestamp("1999-11-14"), selected.index)


if __name__ == "__main__":
    unittest.main()
