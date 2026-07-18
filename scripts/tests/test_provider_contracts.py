import json
import unittest
from pathlib import Path

from provider_contracts import (
    ProviderContractError,
    adr_series_points,
    dart_disclosure_page,
    ecos_statistic_rows,
    fear_greed_rows,
    freesis_rows,
    kofia_page,
    yahoo_close_columns,
)


FIXTURE_DIR = Path(__file__).resolve().parent / "fixtures"


def load_fixture(name: str) -> dict:
    return json.loads((FIXTURE_DIR / name).read_text(encoding="utf-8"))


class ProviderContractTests(unittest.TestCase):
    def test_ecos_fixture_exposes_statistic_rows(self):
        rows = ecos_statistic_rows(load_fixture("ecos_statistic_response.json"))
        self.assertEqual(rows[-1]["DATA_VALUE"], "105.1")

    def test_kofia_fixture_normalizes_items(self):
        page = kofia_page(load_fixture("kofia_credit_response.json"))
        self.assertEqual(page.header["resultCode"], "00")
        self.assertEqual(page.items[0]["basDt"], "20260715")

    def test_dart_fixture_validates_page(self):
        page = dart_disclosure_page(load_fixture("dart_list_response.json"))
        self.assertEqual(page.status, "000")
        self.assertEqual(page.total_page, 1)
        self.assertEqual(page.items[0]["stock_code"], "005930")

    def test_kofia_rejects_malformed_items(self):
        with self.assertRaises(ProviderContractError):
            kofia_page({"response": {"header": {}, "body": {"items": "bad"}}})

    def test_freesis_and_fear_greed_fixtures_validate_rows(self):
        freesis = freesis_rows(load_fixture("freesis_response.json"))
        fear_greed = fear_greed_rows(load_fixture("fear_greed_response.json"))

        self.assertEqual(freesis[0]["TMPV1"], "20260715")
        self.assertEqual(fear_greed[0]["score"], 47.5)

    def test_adr_fixture_validates_embedded_series(self):
        html = (FIXTURE_DIR / "adr_chart_response.html").read_text(encoding="utf-8")

        self.assertEqual(adr_series_points(html, "kospi_adr")[0][1], 101.5)
        with self.assertRaises(ProviderContractError):
            adr_series_points(html, "missing_adr")

    def test_yahoo_fixture_requires_close_columns(self):
        payload = load_fixture("yahoo_download_response.json")
        columns = [tuple(column) for column in payload["columns"]]

        self.assertTrue(yahoo_close_columns(columns, payload["tickers"]))
        self.assertFalse(yahoo_close_columns([("Volume", "005930.KS")], payload["tickers"]))

    def test_remaining_providers_reject_missing_row_containers(self):
        with self.assertRaises(ProviderContractError):
            freesis_rows({})
        with self.assertRaises(ProviderContractError):
            fear_greed_rows({})


if __name__ == "__main__":
    unittest.main()
