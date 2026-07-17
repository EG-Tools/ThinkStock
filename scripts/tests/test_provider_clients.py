from __future__ import annotations

import sys
import unittest
from pathlib import Path

import pandas as pd

SCRIPTS_DIR = Path(__file__).resolve().parents[1]
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from provider_clients import RetryingHttpClient, extract_close_series, fetch_kofia_items


class FakeResponse:
    def __init__(self, status_code: int, payload: dict | None = None) -> None:
        self.status_code = status_code
        self.payload = payload or {}
        self.headers: dict[str, str] = {}

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            error = RuntimeError(f"HTTP {self.status_code}")
            error.response = self
            raise error

    def json(self) -> dict:
        return self.payload


class FakeSession:
    def __init__(self, responses: list[FakeResponse]) -> None:
        self.responses = list(responses)
        self.calls = 0

    def request(self, _method: str, _url: str, **_kwargs) -> FakeResponse:
        self.calls += 1
        return self.responses.pop(0)


class ProviderClientTests(unittest.TestCase):
    def test_close_extraction_rejects_ambiguous_duplicate_columns(self) -> None:
        columns = pd.MultiIndex.from_tuples([
            ("Close", "005930.KS"),
            ("Close", "005930.KS"),
        ])
        data = pd.DataFrame([[100.0, 101.0]], columns=columns)

        self.assertIsNone(extract_close_series(data, "005930.KS"))

    def test_retrying_client_recovers_from_transient_status(self) -> None:
        session = FakeSession([
            FakeResponse(503),
            FakeResponse(200, {"ok": True}),
        ])
        delays: list[float] = []
        client = RetryingHttpClient(
            session=session,
            attempts=3,
            backoff_seconds=0.1,
            sleep_fn=delays.append,
        )

        self.assertEqual(client.get_json("https://example.test"), {"ok": True})
        self.assertEqual(session.calls, 2)
        self.assertEqual(delays, [0.1])

    def test_kofia_client_collects_paginated_items(self) -> None:
        page_one = {
            "response": {
                "header": {"resultCode": "00"},
                "body": {
                    "items": {"item": [{"basDt": "20260715"}]},
                    "totalCount": 2,
                    "numOfRows": 1,
                },
            },
        }
        page_two = {
            "response": {
                "header": {"resultCode": "00"},
                "body": {
                    "items": {"item": {"basDt": "20260716"}},
                    "totalCount": 2,
                    "numOfRows": 1,
                },
            },
        }
        client = RetryingHttpClient(
            session=FakeSession([FakeResponse(200, page_one), FakeResponse(200, page_two)]),
            sleep_fn=lambda _delay: None,
        )

        items = fetch_kofia_items(client, "https://example.test/kofia", "key")

        self.assertEqual([item["basDt"] for item in items], ["20260715", "20260716"])


if __name__ == "__main__":
    unittest.main()
