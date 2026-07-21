from __future__ import annotations

import json
import sys
import tempfile
import time
import unittest
from datetime import date
from pathlib import Path
from unittest.mock import patch

SCRIPTS_DIR = Path(__file__).resolve().parents[1]
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from local_pages_server import DartGateway, is_allowed_origin, is_private_client, load_env_file, years_before


class LocalPagesServerTests(unittest.TestCase):
    def test_load_env_file(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / ".env.local"
            path.write_text("# comment\nDART_API_KEY='secret-value'\nEMPTY=\n", encoding="utf-8")
            self.assertEqual(load_env_file(path)["DART_API_KEY"], "secret-value")

    def test_private_network_filter(self) -> None:
        self.assertTrue(is_private_client("127.0.0.1"))
        self.assertTrue(is_private_client("192.168.0.10"))
        self.assertFalse(is_private_client("8.8.8.8"))
        self.assertTrue(is_allowed_origin("capacitor://localhost"))
        self.assertTrue(is_allowed_origin("http://192.168.0.10:8787"))
        self.assertFalse(is_allowed_origin("https://example.com"))

    def test_leap_day_lookback(self) -> None:
        self.assertEqual(years_before(date(2024, 2, 29), 3), date(2021, 2, 28))

    def test_server_filters_low_impact_disclosures(self) -> None:
        important = DartGateway._record_from_item("005930.KS", {
            "rcept_dt": "20260721",
            "report_nm": "단일판매ㆍ공급계약체결",
            "rcept_no": "1",
        })
        low_impact = DartGateway._record_from_item("005930.KS", {
            "rcept_dt": "20260721",
            "report_nm": "기업설명회(IR)개최",
            "rcept_no": "2",
        })
        self.assertIsNotNone(important)
        self.assertIsNone(low_impact)

    def test_disclosure_cache_avoids_duplicate_dart_requests(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            gateway = DartGateway("test-key", Path(directory), disclosure_ttl_seconds=3600)
            rows = [{"ticker": "005930.KS", "date": "2026-07-21", "title": "중요 공시"}]
            with patch.object(gateway, "_fetch_disclosures", return_value=rows) as fetch:
                first, first_cached = gateway.disclosures("005930.KS")
                second, second_cached = gateway.disclosures("005930.KS")
            self.assertEqual(first, rows)
            self.assertEqual(second, rows)
            self.assertFalse(first_cached)
            self.assertTrue(second_cached)
            fetch.assert_called_once_with("005930.KS")

    def test_force_refresh_replaces_cached_rows(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            cache_dir = Path(directory)
            (cache_dir / "005930.KS.json").write_text(json.dumps({
                "saved_at": time.time(),
                "records": [{"ticker": "005930.KS", "date": "2026-01-01", "title": "이전"}],
            }), encoding="utf-8")
            gateway = DartGateway("test-key", cache_dir, disclosure_ttl_seconds=3600)
            fresh = [{"ticker": "005930.KS", "date": "2026-07-21", "title": "최신"}]
            with patch.object(gateway, "_fetch_disclosures", return_value=fresh) as fetch:
                rows, cached = gateway.disclosures("005930.KS", force=True)
            self.assertEqual(rows, fresh)
            self.assertFalse(cached)
            fetch.assert_called_once_with("005930.KS")


if __name__ == "__main__":
    unittest.main()
