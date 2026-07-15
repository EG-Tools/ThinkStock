import os
import re
import subprocess
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
INDEX_HTML = ROOT / "docs" / "index.html"
SW_JS = ROOT / "docs" / "sw.js"
DATA_WORKER_JS = ROOT / "docs" / "modules" / "data-worker.js"


def resolve_build_version() -> str:
    explicit = os.environ.get("PAGES_BUILD_VERSION", "").strip()
    if explicit:
        raw = explicit
    else:
        run_id = os.environ.get("GITHUB_RUN_ID", "").strip()
        sha = os.environ.get("GITHUB_SHA", "").strip()
        if not sha:
            try:
                sha = subprocess.check_output(
                    ["git", "rev-parse", "HEAD"],
                    cwd=ROOT,
                    text=True,
                    stderr=subprocess.DEVNULL,
                ).strip()
            except Exception:
                sha = ""
        if run_id:
            raw = f"{run_id}-{sha[:12]}" if sha else run_id
        elif sha:
            raw = sha[:12]
        else:
            raw = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")

    version = re.sub(r"[^A-Za-z0-9._-]+", "-", raw).strip("-._")
    return version[:80] or "dev"


def replace_once(text: str, pattern: str, replacement: str, label: str) -> str:
    next_text, count = re.subn(pattern, replacement, text, count=1)
    if count != 1:
        raise RuntimeError(f"Could not stamp {label}")
    return next_text


def main() -> int:
    version = resolve_build_version()
    data_payload_src = f"./modules/data-payload.js?v={version}"
    chart_loader_src = f"./modules/chart-loader.js?v={version}"
    disclosure_policy_src = f"./modules/disclosure-policy.js?v={version}"
    data_worker_src = f"./modules/data-worker.js?v={version}"
    chart_model_worker_src = f"./modules/chart-model-worker.js?v={version}"
    app_src = f"./app.js?v={version}"

    index = INDEX_HTML.read_text(encoding="utf-8")
    index = replace_once(
        index,
        r'<script defer src="\./modules/data-payload\.js(?:\?v=[^"]*)?"></script>',
        f'<script defer src="{data_payload_src}"></script>',
        "index data-payload.js script",
    )
    index = replace_once(
        index,
        r'<script defer src="\./modules/chart-loader\.js(?:\?v=[^"]*)?"></script>',
        f'<script defer src="{chart_loader_src}"></script>',
        "index chart-loader.js script",
    )
    index = replace_once(
        index,
        r'<script defer src="\./modules/disclosure-policy\.js(?:\?v=[^"]*)?"></script>',
        f'<script defer src="{disclosure_policy_src}"></script>',
        "index disclosure-policy.js script",
    )
    index = replace_once(
        index,
        r'<script defer src="\./app\.js(?:\?v=[^"]*)?"></script>',
        f'<script defer src="{app_src}"></script>',
        "index app.js script",
    )
    INDEX_HTML.write_text(index, encoding="utf-8", newline="\n")

    sw = SW_JS.read_text(encoding="utf-8")
    sw = replace_once(
        sw,
        r'"\./modules/data-payload\.js(?:\?v=[^"]*)?",',
        f'"{data_payload_src}",',
        "service worker data-payload.js asset",
    )
    sw = replace_once(
        sw,
        r'const CACHE_NAME = "thinkstock-[^"]+";',
        f'const CACHE_NAME = "thinkstock-{version}";',
        "service worker cache name",
    )
    sw = replace_once(
        sw,
        r'"\./modules/chart-loader\.js(?:\?v=[^"]*)?",',
        f'"{chart_loader_src}",',
        "service worker chart-loader.js asset",
    )
    sw = replace_once(
        sw,
        r'"\./modules/disclosure-policy\.js(?:\?v=[^"]*)?",',
        f'"{disclosure_policy_src}",',
        "service worker disclosure-policy.js asset",
    )
    sw = replace_once(
        sw,
        r'"\./modules/data-worker\.js(?:\?v=[^"]*)?",',
        f'"{data_worker_src}",',
        "service worker data-worker.js asset",
    )
    sw = replace_once(
        sw,
        r'"\./modules/chart-model-worker\.js(?:\?v=[^"]*)?",',
        f'"{chart_model_worker_src}",',
        "service worker chart-model-worker.js asset",
    )
    sw = replace_once(
        sw,
        r'"\./app\.js(?:\?v=[^"]*)?",',
        f'"{app_src}",',
        "service worker app.js asset",
    )
    SW_JS.write_text(sw, encoding="utf-8", newline="\n")

    data_worker = DATA_WORKER_JS.read_text(encoding="utf-8")
    data_worker = replace_once(
        data_worker,
        r'importScripts\("\./data-payload\.js(?:\?v=[^"]*)?"\);',
        f'importScripts("./data-payload.js?v={version}");',
        "data worker data-payload.js import",
    )
    DATA_WORKER_JS.write_text(data_worker, encoding="utf-8", newline="\n")

    print(f"Stamped Pages assets with version {version}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
