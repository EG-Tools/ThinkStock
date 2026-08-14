import json
import tempfile
import unittest
from pathlib import Path

from prepare_pages_artifact import prepare_pages_artifact
from split_pages_data import SEGMENTED_FILES, split_all_payloads


class PreparePagesArtifactTests(unittest.TestCase):
    def test_removes_only_redundant_full_payloads(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            source = root / "docs"
            data_dir = source / "data"
            data_dir.mkdir(parents=True)
            (source / "index.html").write_text("ok", encoding="utf-8")
            for filename in SEGMENTED_FILES:
                (data_dir / filename).write_text(
                    json.dumps({
                        "dates": ["2014-01-01", "2026-01-01"],
                        "columns": {"value": [1, 2]},
                    }),
                    encoding="utf-8",
                )
            (data_dir / "disclosures.json").write_text("{}", encoding="utf-8")
            split_all_payloads(data_dir)

            target = root / "artifact"
            removed = prepare_pages_artifact(source, target)

            self.assertEqual(sorted(removed), sorted(SEGMENTED_FILES))
            self.assertTrue((target / "index.html").exists())
            self.assertTrue((target / "data" / "data_manifest.json").exists())
            self.assertTrue((target / "data" / "prices_recent.json").exists())
            self.assertTrue((target / "data" / "disclosures.json").exists())
            self.assertFalse((target / "data" / "prices.json").exists())


if __name__ == "__main__":
    unittest.main()
