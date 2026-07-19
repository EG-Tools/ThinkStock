from __future__ import annotations

import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


SCRIPTS_DIR = Path(__file__).resolve().parents[1]
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from provider_sources import (
    fetch_krx_universe,
    normalize_krx_universe_rows,
    resolve_api_key,
)


ENDPOINTS = {
    "KOSPI": "stk_isu_base_info",
    "KOSDAQ": "ksq_isu_base_info",
}


class FakeKrxClient:
    def get_json(self, url: str, **_kwargs) -> dict:
        if "stk_isu_base_info" in url:
            return {"OutBlock_1": [{"ISU_SRT_CD": "005930", "ISU_ABBRV": "Samsung"}]}
        if "ksq_isu_base_info" in url:
            return {"OutBlock_1": [{"ISU_SRT_CD": "218410", "ISU_ABBRV": "RFHIC"}]}
        return {}


class ProviderSourceTests(unittest.TestCase):
    def test_api_key_prefers_environment_then_local_file(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            env_file = Path(directory) / ".env.local"
            env_file.write_text("TEST_API_KEY=file-key\n", encoding="utf-8")
            with patch.dict(os.environ, {}, clear=True):
                self.assertEqual(resolve_api_key(env_file, "TEST_API_KEY"), "file-key")
            with patch.dict(os.environ, {"TEST_API_KEY": "env-key"}, clear=True):
                self.assertEqual(resolve_api_key(env_file, "TEST_API_KEY"), "env-key")

    def test_krx_rows_normalize_market_suffix_and_deduplicate(self) -> None:
        records = normalize_krx_universe_rows([
            {"ISU_SRT_CD": "5930", "ISU_ABBRV": "Samsung"},
            {"ISU_SRT_CD": "005930", "ISU_ABBRV": "Samsung"},
        ], "KOSPI", ENDPOINTS)

        self.assertEqual(records, [{
            "ticker": "005930.KS",
            "code": "005930",
            "name": "Samsung",
            "market": "KOSPI",
        }])

    def test_krx_fetch_builds_complete_market_payload(self) -> None:
        payload = fetch_krx_universe(FakeKrxClient(), "key", ENDPOINTS, lookback_days=0)

        self.assertEqual(payload["format"], "krx-universe-v1")
        self.assertEqual(payload["total"], 2)
        self.assertEqual(
            [item["ticker"] for item in payload["records"]],
            ["218410.KQ", "005930.KS"],
        )


if __name__ == "__main__":
    unittest.main()
