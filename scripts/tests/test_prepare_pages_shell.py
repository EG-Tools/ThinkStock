from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from prepare_pages_shell import prepare_pages_shell


class PreparePagesShellTests(unittest.TestCase):
    def test_shell_excludes_data_but_keeps_runtime_assets(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "docs"
            target = root / "shell"
            for filename in ("index.html", "styles.css", "sw.js"):
                (source / filename).parent.mkdir(parents=True, exist_ok=True)
                (source / filename).write_text(filename, encoding="utf-8")
            (source / "assets").mkdir(parents=True)
            (source / "assets" / "app.bundle.min.js").write_text("app", encoding="utf-8")
            (source / "modules").mkdir()
            (source / "modules" / "runtime.js").write_text("runtime", encoding="utf-8")
            (source / "data").mkdir()
            (source / "data" / "prices.json").write_text("{}", encoding="utf-8")

            size = prepare_pages_shell(source, target)

            self.assertGreater(size, 0)
            self.assertTrue((target / "index.html").is_file())
            self.assertTrue((target / "modules" / "runtime.js").is_file())
            self.assertFalse((target / "data").exists())


if __name__ == "__main__":
    unittest.main()
