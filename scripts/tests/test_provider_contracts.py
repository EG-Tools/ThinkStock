import json
import unittest
from pathlib import Path

from provider_contracts import (
    ProviderContractError,
    dart_disclosure_page,
    ecos_statistic_rows,
    kofia_page,
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


if __name__ == "__main__":
    unittest.main()
