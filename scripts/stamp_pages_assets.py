import os
import re
import subprocess
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
INDEX_HTML = ROOT / "docs" / "index.html"
SW_JS = ROOT / "docs" / "sw.js"
DATA_WORKER_MJS = ROOT / "docs" / "modules" / "data-worker.mjs"
CHART_MODEL_WORKER_MJS = ROOT / "docs" / "modules" / "chart-model-worker.mjs"
CHART_WORKER_MODULE_IMPORTS = (
    "./auxiliary-chart-model.mjs",
    "./main-chart-model.mjs",
    "./chart-model-worker-runtime.mjs",
)
DATA_WORKER_MODULE_IMPORTS = (
    "./data-payload.mjs",
)


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


def versioned(path: str, version: str) -> str:
    return f"{path}?v={version}"


def main() -> int:
    version = resolve_build_version()
    bundle_src = versioned("./assets/app.bundle.min.js", version)
    cache_policy_src = versioned("./modules/cache-refresh-policy.js", version)
    data_payload_src = versioned("./modules/data-payload.mjs", version)
    market_data_src = versioned("./modules/market-data.mjs", version)
    chart_adjustments_src = versioned("./modules/chart-adjustments.mjs", version)
    auxiliary_contract_src = versioned("./modules/auxiliary-chart-contract.mjs", version)
    auxiliary_model_src = versioned("./modules/auxiliary-chart-model.mjs", version)
    chart_display_sampler_src = versioned("./modules/chart-display-sampler.mjs", version)
    data_worker_src = versioned("./modules/data-worker.mjs", version)
    chart_worker_src = versioned("./modules/chart-model-worker.mjs", version)
    chart_worker_runtime_src = versioned("./modules/chart-model-worker-runtime.mjs", version)
    plotly_src = versioned("./vendor/plotly-thinkstock-2.35.2.min.js", version)

    index = INDEX_HTML.read_text(encoding="utf-8")
    index = replace_once(
        index,
        r'<script defer src="\./assets/app\.bundle\.min\.js(?:\?v=[^"]*)?"></script>',
        f'<script defer src="{bundle_src}"></script>',
        "index app bundle",
    )
    INDEX_HTML.write_text(index, encoding="utf-8", newline="\n")

    sw = SW_JS.read_text(encoding="utf-8")
    replacements = [
        (
            r'importScripts\("\./modules/cache-refresh-policy\.js(?:\?v=[^"]*)?"\);',
            f'importScripts("{cache_policy_src}");',
            "service worker policy import",
        ),
        (
            r'const CACHE_NAME = "thinkstock-[^"]+";',
            f'const CACHE_NAME = "thinkstock-{version}";',
            "service worker cache name",
        ),
    ]
    for asset, label in (
        (bundle_src, "app bundle"),
        (cache_policy_src, "cache policy"),
        (data_payload_src, "data payload"),
        (market_data_src, "market data"),
        (chart_adjustments_src, "chart adjustments"),
        (auxiliary_contract_src, "auxiliary contract"),
        (auxiliary_model_src, "auxiliary model"),
        (chart_display_sampler_src, "chart display sampler"),
        (data_worker_src, "data worker"),
        (chart_worker_src, "chart worker"),
        (chart_worker_runtime_src, "chart worker runtime"),
        (plotly_src, "Plotly"),
    ):
        base = asset.split("?v=", 1)[0]
        replacements.append((
            rf'"{re.escape(base)}(?:\?v=[^"]*)?",',
            f'"{asset}",',
            f"service worker {label}",
        ))
    for pattern, replacement, label in replacements:
        sw = replace_once(sw, pattern, replacement, label)
    SW_JS.write_text(sw, encoding="utf-8", newline="\n")

    data_worker = DATA_WORKER_MJS.read_text(encoding="utf-8")
    for module_path in DATA_WORKER_MODULE_IMPORTS:
        data_worker = replace_once(
            data_worker,
            rf'"{re.escape(module_path)}(?:\?v=[^"]*)?"',
            f'"{module_path}?v={version}"',
            f"data worker import {module_path}",
        )
    DATA_WORKER_MJS.write_text(data_worker, encoding="utf-8", newline="\n")

    chart_worker = CHART_MODEL_WORKER_MJS.read_text(encoding="utf-8")
    for module_path in CHART_WORKER_MODULE_IMPORTS:
        chart_worker = replace_once(
            chart_worker,
            rf'"{re.escape(module_path)}(?:\?v=[^"]*)?"',
            f'"{module_path}?v={version}"',
            f"chart worker import {module_path}",
        )
    CHART_MODEL_WORKER_MJS.write_text(chart_worker, encoding="utf-8", newline="\n")

    print(f"Stamped Pages assets with version {version}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
