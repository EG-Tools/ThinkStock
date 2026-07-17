from __future__ import annotations

import sys
import unittest
from pathlib import Path


SCRIPTS_DIR = Path(__file__).resolve().parents[1]
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from build_pages_data import build_dart_corp_code_payload


class BuildPagesDataHelperTests(unittest.TestCase):
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


if __name__ == "__main__":
    unittest.main()
