import os
import re
import subprocess
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
INDEX_HTML = ROOT / "docs" / "index.html"
SW_JS = ROOT / "docs" / "sw.js"
DATA_WORKER_JS = ROOT / "docs" / "modules" / "data-worker.js"
CHART_MODEL_WORKER_JS = ROOT / "docs" / "modules" / "chart-model-worker.js"


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
    market_data_src = f"./modules/market-data.js?v={version}"
    chart_interaction_math_src = f"./modules/chart-interaction-math.js?v={version}"
    chart_interaction_controller_src = f"./modules/chart-interaction-controller.js?v={version}"
    cache_refresh_policy_src = f"./modules/cache-refresh-policy.js?v={version}"
    browser_market_client_src = f"./modules/browser-market-client.js?v={version}"
    auxiliary_chart_model_src = f"./modules/auxiliary-chart-model.js?v={version}"
    performance_monitor_src = f"./modules/performance-monitor.js?v={version}"
    app_storage_src = f"./modules/app-storage.js?v={version}"
    startup_loader_src = f"./modules/startup-loader.js?v={version}"
    chart_loader_src = f"./modules/chart-loader.js?v={version}"
    disclosure_policy_src = f"./modules/disclosure-policy.js?v={version}"
    disclosure_popover_src = f"./modules/disclosure-popover.js?v={version}"
    dart_disclosure_src = f"./modules/dart-disclosure.js?v={version}"
    service_worker_client_src = f"./modules/service-worker-client.js?v={version}"
    runtime_refresh_src = f"./modules/runtime-refresh.js?v={version}"
    data_seed_loader_src = f"./modules/data-seed-loader.js?v={version}"
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
        r'<script defer src="\./modules/market-data\.js(?:\?v=[^"]*)?"></script>',
        f'<script defer src="{market_data_src}"></script>',
        "index market-data.js script",
    )
    index = replace_once(
        index,
        r'<script defer src="\./modules/chart-interaction-math\.js(?:\?v=[^"]*)?"></script>',
        f'<script defer src="{chart_interaction_math_src}"></script>',
        "index chart-interaction-math.js script",
    )
    index = replace_once(
        index,
        r'<script defer src="\./modules/chart-interaction-controller\.js(?:\?v=[^"]*)?"></script>',
        f'<script defer src="{chart_interaction_controller_src}"></script>',
        "index chart-interaction-controller.js script",
    )
    index = replace_once(
        index,
        r'<script defer src="\./modules/browser-market-client\.js(?:\?v=[^"]*)?"></script>',
        f'<script defer src="{browser_market_client_src}"></script>',
        "index browser-market-client.js script",
    )
    index = replace_once(
        index,
        r'<script defer src="\./modules/auxiliary-chart-model\.js(?:\?v=[^"]*)?"></script>',
        f'<script defer src="{auxiliary_chart_model_src}"></script>',
        "index auxiliary-chart-model.js script",
    )
    index = replace_once(
        index,
        r'<script defer src="\./modules/performance-monitor\.js(?:\?v=[^"]*)?"></script>',
        f'<script defer src="{performance_monitor_src}"></script>',
        "index performance-monitor.js script",
    )
    index = replace_once(
        index,
        r'<script defer src="\./modules/app-storage\.js(?:\?v=[^"]*)?"></script>',
        f'<script defer src="{app_storage_src}"></script>',
        "index app-storage.js script",
    )
    index = replace_once(
        index,
        r'<script defer src="\./modules/startup-loader\.js(?:\?v=[^"]*)?"></script>',
        f'<script defer src="{startup_loader_src}"></script>',
        "index startup-loader.js script",
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
        r'<script defer src="\./modules/disclosure-popover\.js(?:\?v=[^"]*)?"></script>',
        f'<script defer src="{disclosure_popover_src}"></script>',
        "index disclosure-popover.js script",
    )
    index = replace_once(
        index,
        r'<script defer src="\./modules/dart-disclosure\.js(?:\?v=[^"]*)?"></script>',
        f'<script defer src="{dart_disclosure_src}"></script>',
        "index dart-disclosure.js script",
    )
    index = replace_once(
        index,
        r'<script defer src="\./modules/service-worker-client\.js(?:\?v=[^"]*)?"></script>',
        f'<script defer src="{service_worker_client_src}"></script>',
        "index service-worker-client.js script",
    )
    index = replace_once(
        index,
        r'<script defer src="\./modules/runtime-refresh\.js(?:\?v=[^"]*)?"></script>',
        f'<script defer src="{runtime_refresh_src}"></script>',
        "index runtime-refresh.js script",
    )
    index = replace_once(
        index,
        r'<script defer src="\./modules/data-seed-loader\.js(?:\?v=[^"]*)?"></script>',
        f'<script defer src="{data_seed_loader_src}"></script>',
        "index data-seed-loader.js script",
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
        r'"\./modules/market-data\.js(?:\?v=[^"]*)?",',
        f'"{market_data_src}",',
        "service worker market-data.js asset",
    )
    sw = replace_once(
        sw,
        r'"\./modules/chart-interaction-math\.js(?:\?v=[^"]*)?",',
        f'"{chart_interaction_math_src}",',
        "service worker chart-interaction-math.js asset",
    )
    sw = replace_once(
        sw,
        r'"\./modules/chart-interaction-controller\.js(?:\?v=[^"]*)?",',
        f'"{chart_interaction_controller_src}",',
        "service worker chart-interaction-controller.js asset",
    )
    sw = replace_once(
        sw,
        r'"\./modules/cache-refresh-policy\.js(?:\?v=[^"]*)?",',
        f'"{cache_refresh_policy_src}",',
        "service worker cache-refresh-policy.js asset",
    )
    sw = replace_once(
        sw,
        r'importScripts\("\./modules/cache-refresh-policy\.js(?:\?v=[^"]*)?"\);',
        f'importScripts("{cache_refresh_policy_src}");',
        "service worker cache-refresh-policy.js import",
    )
    sw = replace_once(
        sw,
        r'"\./modules/browser-market-client\.js(?:\?v=[^"]*)?",',
        f'"{browser_market_client_src}",',
        "service worker browser-market-client.js asset",
    )
    sw = replace_once(
        sw,
        r'"\./modules/auxiliary-chart-model\.js(?:\?v=[^"]*)?",',
        f'"{auxiliary_chart_model_src}",',
        "service worker auxiliary-chart-model.js asset",
    )
    sw = replace_once(
        sw,
        r'"\./modules/performance-monitor\.js(?:\?v=[^"]*)?",',
        f'"{performance_monitor_src}",',
        "service worker performance-monitor.js asset",
    )
    sw = replace_once(
        sw,
        r'"\./modules/app-storage\.js(?:\?v=[^"]*)?",',
        f'"{app_storage_src}",',
        "service worker app-storage.js asset",
    )
    sw = replace_once(
        sw,
        r'"\./modules/startup-loader\.js(?:\?v=[^"]*)?",',
        f'"{startup_loader_src}",',
        "service worker startup-loader.js asset",
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
        r'"\./modules/disclosure-popover\.js(?:\?v=[^"]*)?",',
        f'"{disclosure_popover_src}",',
        "service worker disclosure-popover.js asset",
    )
    sw = replace_once(
        sw,
        r'"\./modules/dart-disclosure\.js(?:\?v=[^"]*)?",',
        f'"{dart_disclosure_src}",',
        "service worker dart-disclosure.js asset",
    )
    sw = replace_once(
        sw,
        r'"\./modules/service-worker-client\.js(?:\?v=[^"]*)?",',
        f'"{service_worker_client_src}",',
        "service worker service-worker-client.js asset",
    )
    sw = replace_once(
        sw,
        r'"\./modules/runtime-refresh\.js(?:\?v=[^"]*)?",',
        f'"{runtime_refresh_src}",',
        "service worker runtime-refresh.js asset",
    )
    sw = replace_once(
        sw,
        r'"\./modules/data-seed-loader\.js(?:\?v=[^"]*)?",',
        f'"{data_seed_loader_src}",',
        "service worker data-seed-loader.js asset",
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

    chart_model_worker = CHART_MODEL_WORKER_JS.read_text(encoding="utf-8")
    chart_model_worker = replace_once(
        chart_model_worker,
        r'importScripts\("\./market-data\.js(?:\?v=[^"]*)?"\);',
        f'importScripts("./market-data.js?v={version}");',
        "chart model worker market-data.js import",
    )
    chart_model_worker = replace_once(
        chart_model_worker,
        r'importScripts\("\./auxiliary-chart-model\.js(?:\?v=[^"]*)?"\);',
        f'importScripts("./auxiliary-chart-model.js?v={version}");',
        "chart model worker auxiliary-chart-model.js import",
    )
    CHART_MODEL_WORKER_JS.write_text(chart_model_worker, encoding="utf-8", newline="\n")

    print(f"Stamped Pages assets with version {version}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
