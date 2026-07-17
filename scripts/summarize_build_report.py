from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
REPORT_PATH = ROOT / "docs" / "data" / "build_report.json"


def main() -> int:
    print("## ThinkStock data build")
    if not REPORT_PATH.exists():
        print("\nBuild report was not created.")
        return 0
    try:
        report = json.loads(REPORT_PATH.read_text(encoding="utf-8"))
    except Exception as exc:
        print(f"\nBuild report could not be read: {exc}")
        return 0

    health = report.get("health") if isinstance(report.get("health"), dict) else {}
    http = health.get("http") if isinstance(health.get("http"), dict) else {}
    print()
    print(f"- Mode: `{report.get('mode', 'unknown')}`")
    print(f"- Generated: `{report.get('generated_at', 'unknown')}`")
    print(f"- Duration: `{int(health.get('total_duration_ms') or 0)} ms`")
    print(
        "- HTTP: "
        f"`{int(http.get('requests') or 0)} requests`, "
        f"`{int(http.get('retries') or 0)} retries`, "
        f"`{int(http.get('failures') or 0)} failures`"
    )
    print()
    print("| Source | Status | Rows | Latest | Age | Duration |")
    print("|---|---:|---:|---:|---:|---:|")
    sources = report.get("sources") if isinstance(report.get("sources"), dict) else {}
    for name, summary in sources.items():
        if not isinstance(summary, dict) or "status" not in summary:
            continue
        age = summary.get("age_days")
        print(
            f"| {name} | {summary.get('status', '')} | {int(summary.get('rows') or 0)} "
            f"| {summary.get('latest') or '-'} | {age if age is not None else '-'} "
            f"| {int(summary.get('duration_ms') or 0)} ms |"
        )
    warnings = health.get("warnings") if isinstance(health.get("warnings"), list) else []
    if warnings:
        print()
        print("### Warnings")
        for warning in warnings:
            print(f"- {warning}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
