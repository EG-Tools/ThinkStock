from __future__ import annotations

import json
from datetime import date, timedelta

import pandas as pd

from build_pages_data import (
    DATA_DIR,
    DISPLAY_NAMES,
    ECOS_NEWS_START,
    MACRO_SERIES,
    OUTPUT_MACRO_JSON,
    build_payload,
    fetch_ecos_news_sentiment,
    load_existing_macro_seed,
    merge_macro_frame,
    resolve_ecos_api_key,
    write_columnar_payload_or_keep,
)
from split_pages_data import split_all_payloads, sync_segmented_mirror


def clean_news_frame(frame: pd.DataFrame) -> pd.DataFrame:
    if frame.empty or "news_sentiment" not in frame:
        return pd.DataFrame(columns=["news_sentiment"])
    out = frame[["news_sentiment"]].copy()
    out["news_sentiment"] = pd.to_numeric(out["news_sentiment"], errors="coerce")
    out = out.loc[out["news_sentiment"].between(0, 200, inclusive="neither")]
    out = out[~out.index.duplicated(keep="last")].sort_index()
    out.index.name = "date"
    return out


def news_values_changed(existing: pd.DataFrame, incoming: pd.DataFrame) -> bool:
    if incoming.empty:
        return False
    current = (
        pd.to_numeric(existing["news_sentiment"], errors="coerce")
        if "news_sentiment" in existing
        else pd.Series(dtype="float64")
    )
    for timestamp, value in incoming["news_sentiment"].items():
        previous = current.get(timestamp, pd.NA)
        if pd.isna(previous) or abs(float(previous) - float(value)) > 0.000001:
            return True
    return False


def main() -> int:
    api_key = resolve_ecos_api_key()
    if not api_key:
        raise RuntimeError(".env.local에 ECOS_API_KEY가 필요합니다.")

    incoming = clean_news_frame(fetch_ecos_news_sentiment(api_key, ECOS_NEWS_START))
    if len(incoming) < 5000 or incoming.index.min().date() > date(2005, 1, 10):
        raise RuntimeError("ECOS 뉴스심리 과거 이력이 불완전합니다.")
    if incoming.index.max().date() < date.today() - timedelta(days=14):
        raise RuntimeError("ECOS 뉴스심리 최신 자료가 14일 이상 지연되었습니다.")

    existing = load_existing_macro_seed()
    changed = news_values_changed(existing, incoming)
    if changed:
        merged = merge_macro_frame(existing, incoming)
        payload = build_payload(merged, DISPLAY_NAMES, MACRO_SERIES)
        write_columnar_payload_or_keep(OUTPUT_MACRO_JSON, payload, "Macro")

    segments = split_all_payloads(DATA_DIR)
    mirrored_files = sync_segmented_mirror(
        DATA_DIR,
        DATA_DIR.parents[1] / ".thinkstock-cache" / "pages-data",
    )
    summary = {
        "output": str(OUTPUT_MACRO_JSON.relative_to(DATA_DIR.parents[1])).replace("\\", "/"),
        "rows": len(incoming),
        "firstDate": incoming.index.min().strftime("%Y-%m-%d"),
        "latestDate": incoming.index.max().strftime("%Y-%m-%d"),
        "changed": changed,
        "recentRows": segments.get("macro_data", {}).get("recent", 0),
        "historyRows": segments.get("macro_data", {}).get("history", 0),
        "mirroredFiles": mirrored_files,
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
