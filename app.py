import io
from datetime import date, datetime
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

import pandas as pd
import plotly.graph_objects as go
import streamlit as st
import yfinance as yf

st.set_page_config(
    page_title="ThinkStock",
    layout="wide",
    initial_sidebar_state="collapsed",
)

APP_TITLE = "ThinkStock"
DEFAULT_TICKERS = "^KS11,^KQ11,005930.KS,218410.KQ"
DEFAULT_SELECTED_SERIES = ["leading_cycle", "^KS11"]
DATE_PRESET_YEARS = [1, 5, 10, 20, 30]
SERIES_PRIORITY = ["leading_cycle", "^KS11", "kospi_credit", "^KQ11", "kosdaq_credit", "005930.KS", "218410.KQ"]
DEFAULT_CSV = """date,leading_cycle,kospi_credit,kosdaq_credit
2000-01-01,100.5,5.5,3.2
2000-07-01,99.5,5.7,3.3
2001-01-01,99.1,6.0,3.5
2001-06-01,98.5,6.1,3.6
2002-01-01,99.6,6.3,3.7
2002-06-01,100.8,6.5,3.8
2003-01-01,100.6,6.5,3.8
2003-06-01,100.2,6.7,3.9
2004-01-01,100.6,6.9,4.0
2004-06-01,101.2,7.1,4.1
2005-01-01,101.1,7.4,4.3
2005-06-01,101.0,7.7,4.4
2006-01-01,101.2,8.0,4.5
2006-06-01,101.5,8.2,4.5
2007-01-01,101.4,8.6,4.7
2007-06-01,101.3,9.1,4.9
2008-01-01,100.8,9.5,5.1
2008-06-01,99.8,9.2,5.0
2009-01-01,97.8,7.8,4.2
2009-02-01,97.2,7.8,4.2
2009-06-01,98.5,8.2,4.5
2009-12-01,100.5,8.8,4.9
2010-06-01,101.3,9.5,5.3
2010-12-01,101.8,10.1,5.7
2011-06-01,101.0,10.5,6.0
2011-12-01,100.2,10.8,6.2
2012-01-01,99.9,10.7,6.1
2012-06-01,99.1,10.5,5.9
2013-01-01,99.5,10.4,5.8
2013-06-01,99.8,10.6,5.9
2014-01-01,100.0,10.9,6.2
2014-06-01,100.2,11.2,6.5
2015-01-01,100.1,11.5,7.0
2015-06-01,100.0,11.8,7.2
2016-01-01,99.7,12.0,7.3
2016-06-01,99.3,12.2,7.4
2017-01-01,99.8,12.7,7.7
2017-06-01,100.4,13.2,8.0
2018-01-01,100.1,14.0,8.5
2018-06-01,99.7,13.8,8.3
2019-01-01,99.3,12.5,7.2
2019-06-01,98.9,11.5,6.5
2020-01-01,98.5,12.5,7.5
2020-04-01,97.5,14.5,9.0
2020-07-01,99.0,17.0,11.5
2021-01-01,100.3,19.0,13.0
2021-06-01,101.2,19.5,13.5
2022-01-01,100.5,19.0,12.5
2022-06-01,99.5,18.0,11.0
2023-01-01,98.9,17.1,9.5
2024-01-01,99.8,19.6,10.8
2025-01-01,100.3,20.2,11.4
2026-01-01,101.6,20.6,11.8
2026-02-01,102.2,20.9,12.1
2026-03-01,101.8,20.1,11.5
"""
DISPLAY_NAMES = {
    "leading_cycle": "선행지수 순환변동치",
    "kospi_credit": "코스피 신용잔고",
    "kosdaq_credit": "코스닥 신용잔고",
    "^KS11": "코스피",
    "^KQ11": "코스닥",
    "005930.KS": "삼성전자",
    "218410.KQ": "RFHIC",
}
PRESET_OPTIONS = {
    "기본 보기": ["^KS11", "leading_cycle"],
    "시장 + 거시 밸런스": [
        "leading_cycle",
        "kospi_credit",
        "kosdaq_credit",
        "^KS11",
        "^KQ11",
    ],
    "코스피 레짐 체크": ["leading_cycle", "kospi_credit", "^KS11", "005930.KS"],
    "코스닥 모멘텀 체크": ["leading_cycle", "kosdaq_credit", "^KQ11", "218410.KQ"],
    "반도체 비교": ["leading_cycle", "^KS11", "005930.KS", "218410.KQ"],
}
COLORWAY = [
    "#1d5f4a",
    "#c17335",
    "#26547c",
    "#d14d41",
    "#6c5ce7",
    "#0f8b8d",
    "#8a6f4d",
]
HELP_TEXT = """
- 가격 데이터는 Yahoo Finance에서 자동 조회합니다.
- 선행지수, 신용잔고 같은 매크로 데이터는 샘플 CSV, 업로드, 붙여넣기, 원격 CSV URL 중 하나로 넣을 수 있습니다.
- 월별 매크로 데이터는 가격 날짜 축에 맞춰 시간 보간해서, 더 촘촘한 흐름으로 비교할 수 있습니다.
- 아이폰에서 볼 때는 설정을 접고 차트 중심으로 보는 흐름을 기본으로 잡았습니다.
"""
GUIDE_MARKDOWN = """
### iPhone에서 가장 빨리 테스트하는 방법
1. GitHub 저장소를 Streamlit Community Cloud에 연결합니다.
2. 배포 엔트리 파일로 `streamlit_app.py`를 선택합니다.
3. 배포된 URL을 아이폰 Safari에서 열고 `홈 화면에 추가`를 누르면 앱처럼 쓸 수 있습니다.

### 로컬 네트워크에서 테스트하는 방법
- 같은 Wi-Fi에 연결된 아이폰에서 PC의 로컬 IP와 `8501` 포트로 접속하면 됩니다.
- 이번 배치 실행 스크립트는 `0.0.0.0`으로 바인딩되도록 이미 맞춰 두었습니다.

### 데이터 소스 구성
- 가격: Yahoo Finance
- 매크로: 샘플 CSV, 파일 업로드, 직접 붙여넣기, 원격 CSV URL
- 원격 CSV URL은 GitHub Raw, Google Sheets CSV 공개 링크 같은 형태에 잘 맞습니다.

### 현재 한계
- 금융투자협회 OpenAPI 실시간 연동은 아직 별도 서비스키/엔드포인트 작업이 필요합니다.
- 지금 앱은 그 단계 전까지도 배포 환경에서 계속 쓰기 쉽도록 원격 CSV URL 입력을 먼저 지원합니다.
"""


def inject_styles() -> None:
    st.markdown(
        """
        <style>
        :root {
            --bg-top: #f3efe2;
            --bg-bottom: #faf7ef;
            --card: rgba(255, 252, 244, 0.86);
            --card-strong: rgba(255, 250, 240, 0.96);
            --ink: #173022;
            --muted: #5e6f66;
            --accent: #1d5f4a;
            --accent-soft: rgba(29, 95, 74, 0.12);
            --warm: #c17335;
            --warn: #ad4e2c;
            --border: rgba(23, 48, 34, 0.12);
            --shadow: 0 18px 40px rgba(23, 48, 34, 0.08);
        }
        .stApp {
            background:
                radial-gradient(circle at top left, rgba(193, 115, 53, 0.10), transparent 28%),
                radial-gradient(circle at top right, rgba(29, 95, 74, 0.10), transparent 26%),
                linear-gradient(180deg, var(--bg-top) 0%, var(--bg-bottom) 100%);
            color: var(--ink);
        }
        .block-container {
            max-width: 1180px;
            padding-top: 1.2rem;
            padding-bottom: 3.5rem;
        }
        .hero-card {
            background: linear-gradient(145deg, rgba(255, 249, 237, 0.94), rgba(247, 242, 229, 0.88));
            border: 1px solid var(--border);
            border-radius: 28px;
            padding: 1.35rem 1.35rem 1.1rem;
            box-shadow: var(--shadow);
        }
        .hero-eyebrow {
            display: inline-block;
            margin-bottom: 0.65rem;
            padding: 0.3rem 0.65rem;
            border-radius: 999px;
            background: var(--accent-soft);
            color: var(--accent);
            font-size: 0.82rem;
            font-weight: 700;
            letter-spacing: 0.04em;
        }
        .hero-title {
            margin: 0;
            color: var(--ink);
            font-size: 2.35rem;
            line-height: 1.02;
            letter-spacing: -0.03em;
        }
        .hero-copy {
            margin: 0.8rem 0 0;
            max-width: 760px;
            color: var(--muted);
            font-size: 1rem;
            line-height: 1.55;
        }
        .pill-row {
            display: flex;
            flex-wrap: wrap;
            gap: 0.45rem;
            margin-top: 1rem;
        }
        .status-pill {
            display: inline-flex;
            align-items: center;
            padding: 0.34rem 0.72rem;
            border-radius: 999px;
            border: 1px solid var(--border);
            background: rgba(255, 255, 255, 0.75);
            color: var(--ink);
            font-size: 0.84rem;
            font-weight: 600;
        }
        .status-pill.ok {
            background: rgba(29, 95, 74, 0.10);
            color: var(--accent);
        }
        .status-pill.warn {
            background: rgba(173, 78, 44, 0.10);
            color: var(--warn);
        }
        .status-pill.note {
            background: rgba(193, 115, 53, 0.10);
            color: #8c5725;
        }
        div[data-testid="stExpander"] {
            border: 1px solid var(--border);
            border-radius: 22px;
            background: var(--card);
            box-shadow: var(--shadow);
        }
        div[data-testid="stMetric"] {
            background: var(--card-strong);
            border: 1px solid var(--border);
            border-radius: 20px;
            padding: 0.75rem 0.9rem;
            box-shadow: 0 10px 26px rgba(23, 48, 34, 0.05);
        }
        div[data-testid="stMetricLabel"] > div,
        div[data-testid="stMetricValue"],
        div[data-testid="stMetricDelta"] {
            color: var(--ink);
        }
        .section-note {
            color: var(--muted);
            font-size: 0.92rem;
            line-height: 1.5;
        }
        .source-card {
            padding: 0.95rem 1rem;
            border-radius: 20px;
            background: var(--card-strong);
            border: 1px solid var(--border);
            box-shadow: 0 10px 26px rgba(23, 48, 34, 0.05);
        }
        .source-card h4 {
            margin: 0 0 0.25rem;
            color: var(--ink);
        }
        .source-card p {
            margin: 0;
            color: var(--muted);
            line-height: 1.45;
        }
        [data-testid="stSidebar"] {
            background: linear-gradient(180deg, rgba(248, 244, 236, 0.95), rgba(243, 239, 226, 0.95));
            border-right: 1px solid var(--border);
        }
        @media (max-width: 768px) {
            .block-container {
                padding-left: 0.85rem;
                padding-right: 0.85rem;
                padding-top: 0.8rem;
            }
            .hero-card {
                padding: 1rem;
                border-radius: 22px;
            }
            .hero-title {
                font-size: 1.9rem;
            }
            .hero-copy {
                font-size: 0.95rem;
            }
        }
        </style>
        """,
        unsafe_allow_html=True,
    )


def label_name(name: str) -> str:
    return DISPLAY_NAMES.get(name, name)


def decode_text_bytes(data: bytes) -> str:
    for encoding in ("utf-8-sig", "utf-8", "cp949", "euc-kr"):
        try:
            return data.decode(encoding)
        except UnicodeDecodeError:
            continue
    return data.decode("utf-8", errors="replace")


@st.cache_data(ttl=900, show_spinner=False)
def fetch_remote_text(url: str) -> str:
    request = Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urlopen(request, timeout=20) as response:
        return decode_text_bytes(response.read())


def extract_close_series(data: pd.DataFrame, ticker: str) -> pd.Series | None:
    close_series = None
    if isinstance(data.columns, pd.MultiIndex):
        if ("Close", ticker) in data.columns:
            close_series = data[("Close", ticker)]
        elif ("Adj Close", ticker) in data.columns:
            close_series = data[("Adj Close", ticker)]
        else:
            try:
                close_series = data.xs("Close", axis=1, level=0).iloc[:, 0]
            except Exception:
                close_series = None
    else:
        if "Close" in data.columns:
            close_series = data["Close"]
        elif "Adj Close" in data.columns:
            close_series = data["Adj Close"]
    return close_series


@st.cache_data(ttl=3600, show_spinner=False)
def fetch_prices(
    tickers: tuple[str, ...], start: date, end: date
) -> tuple[pd.DataFrame, list[str], dict[str, str]]:
    frames: list[pd.DataFrame] = []
    success: list[str] = []
    failures: dict[str, str] = {}

    for raw_ticker in tickers:
        ticker = raw_ticker.strip()
        if not ticker:
            continue

        try:
            data = yf.download(
                ticker,
                start=start,
                end=pd.Timestamp(end) + pd.Timedelta(days=1),
                auto_adjust=False,
                progress=False,
                threads=False,
            )
            if data is None or data.empty:
                failures[ticker] = "가격 데이터를 찾지 못했습니다."
                continue

            close_series = extract_close_series(data, ticker)
            if close_series is None:
                failures[ticker] = "종가 컬럼을 찾지 못했습니다."
                continue

            series = close_series.rename(ticker).dropna()
            index = pd.to_datetime(series.index)
            try:
                index = index.tz_localize(None)
            except Exception:
                try:
                    index = index.tz_convert(None)
                except Exception:
                    pass
            series.index = index
            frames.append(series.to_frame())
            success.append(ticker)
        except Exception as exc:
            message = str(exc).splitlines()[0].strip()
            failures[ticker] = message or "알 수 없는 오류가 발생했습니다."

    if not frames:
        return pd.DataFrame(), success, failures

    out = pd.concat(frames, axis=1).sort_index()
    out.index.name = "date"
    return out, success, failures


def parse_user_csv(text: str) -> pd.DataFrame:
    if not text.strip():
        return pd.DataFrame()

    df = pd.read_csv(io.StringIO(text.strip()))
    df.columns = [str(col).strip() for col in df.columns]
    if df.empty:
        return df
    if "date" not in df.columns:
        raise ValueError("CSV 컬럼 중에 'date'가 있어야 합니다.")

    df["date"] = pd.to_datetime(df["date"])
    for col in df.columns:
        if col == "date":
            continue
        df[col] = pd.to_numeric(df[col], errors="coerce")
    df = df.sort_values("date").drop_duplicates("date")
    return df


def centered_scale(series: pd.Series, scale_pct: float, normalized: bool) -> pd.Series:
    numeric = pd.to_numeric(series, errors="coerce")
    valid = numeric.dropna()
    if valid.empty:
        return numeric
    pivot = 100.0 if normalized else (float(valid.min()) + float(valid.max())) / 2.0
    return pivot + (numeric - pivot) * (scale_pct / 100.0)


def auto_fit_scales(
    df: pd.DataFrame, cols: list[str], normalized: bool
) -> dict[str, float]:
    info: list[tuple[str, float]] = []
    for col in cols:
        series = pd.to_numeric(df[col], errors="coerce").dropna()
        if series.empty:
            continue
        if normalized:
            base = series.iloc[0] if series.iloc[0] != 0 else 1.0
            series = (series / base) * 100.0
        series_range = max(float(series.max() - series.min()), 1.0)
        info.append((col, series_range))

    if not info:
        return {}

    target = sorted(value for _, value in info)[len(info) // 2]
    return {
        col: round(max(5.0, min(5000.0, (target / value) * 100.0)), 1)
        for col, value in info
    }


def normalize_df(df: pd.DataFrame, cols: list[str]) -> pd.DataFrame:
    """Normalize all cols to 100 at the same date — the latest first-data date
    among all cols. This keeps KOSPI and macro series visually aligned even when
    their data histories start at different times."""
    out = df.copy()
    first_dates = []
    for col in cols:
        valid = pd.to_numeric(out[col], errors="coerce").dropna()
        if not valid.empty:
            first_dates.append(valid.index[0])
    if not first_dates:
        return out
    common_base_date = max(first_dates)
    for col in cols:
        series = pd.to_numeric(out[col], errors="coerce")
        after = series[series.index >= common_base_date].dropna()
        if after.empty:
            continue
        base = after.iloc[0] if after.iloc[0] != 0 else 1.0
        out[col] = (series / base) * 100.0
    return out


def interpolate_manual_to_price_index(
    manual: pd.DataFrame,
    price_index: pd.DatetimeIndex,
) -> pd.DataFrame:
    if manual.empty:
        return manual

    target_index = pd.DatetimeIndex(price_index).sort_values().unique()
    if target_index.empty:
        target_index = pd.date_range(
            start=manual.index.min(),
            end=manual.index.max(),
            freq="B",
        )

    target_index = target_index[(target_index >= manual.index.min()) & (target_index <= manual.index.max())]
    if target_index.empty:
        return manual.iloc[0:0].copy()

    expanded = manual.reindex(manual.index.union(target_index)).sort_index()
    expanded = expanded.interpolate(method="time", limit_area="inside")
    dense = expanded.reindex(target_index)
    dense.index.name = "date"
    return dense


def merge_sources(
    price_df: pd.DataFrame,
    manual_df: pd.DataFrame,
    start: date,
    end: date,
) -> tuple[pd.DataFrame, list[str], list[str]]:
    if price_df.empty and manual_df.empty:
        return pd.DataFrame(), [], []

    start_ts = pd.Timestamp(start)
    end_ts = pd.Timestamp(end)
    price = price_df.copy().sort_index()
    manual = (
        manual_df.copy().set_index("date").sort_index() if not manual_df.empty else pd.DataFrame()
    )
    price_cols = list(price.columns)
    manual_cols = list(manual.columns)

    if manual_cols:
        manual = manual.apply(pd.to_numeric, errors="coerce")
        manual = interpolate_manual_to_price_index(manual, price.index)

    merged = pd.concat([price, manual], axis=1).sort_index()
    if price_cols:
        base_index = pd.DatetimeIndex(price.index).sort_values().unique()
    else:
        base_index = pd.DatetimeIndex(merged.index).sort_values().unique()

    merged = merged.reindex(base_index).sort_index()
    merged = merged.loc[(merged.index >= start_ts) & (merged.index <= end_ts)].copy()
    merged.index = pd.to_datetime(merged.index)
    merged.index.name = "date"
    return merged, manual_cols, price_cols


def format_value(value: float) -> str:
    if pd.isna(value):
        return "-"
    absolute = abs(float(value))
    if absolute >= 1000:
        return f"{value:,.0f}"
    if absolute >= 100:
        return f"{value:,.1f}"
    return f"{value:,.2f}"


def format_delta(value: float | None) -> str | None:
    if value is None or pd.isna(value):
        return None
    return f"{value:+,.2f}"


def series_snapshot(series: pd.Series) -> tuple[pd.Timestamp, float, float | None] | None:
    valid = pd.to_numeric(series, errors="coerce").dropna()
    if valid.empty:
        return None
    latest_date = pd.Timestamp(valid.index[-1])
    latest_value = float(valid.iloc[-1])
    previous_value = float(valid.iloc[-2]) if len(valid) > 1 else None
    return latest_date, latest_value, previous_value


def chunk_list(items: list[str], size: int) -> list[list[str]]:
    return [items[index : index + size] for index in range(0, len(items), size)]


def years_before(reference: date, years: int) -> date:
    try:
        return reference.replace(year=reference.year - years)
    except ValueError:
        return reference.replace(year=reference.year - years, month=2, day=28)


def sort_series_names(series_names: list[str]) -> list[str]:
    priority = {name: index for index, name in enumerate(SERIES_PRIORITY)}
    return sorted(
        series_names,
        key=lambda name: (priority.get(name, len(SERIES_PRIORITY) + 1), label_name(name)),
    )


def default_selected_series(all_series: list[str]) -> list[str]:
    selected = [series for series in DEFAULT_SELECTED_SERIES if series in all_series]
    return selected or all_series[: min(2, len(all_series))]


def sync_series_checkboxes(all_series: list[str], selected: list[str]) -> None:
    selected_set = set(selected)
    for series in all_series:
        st.session_state[f"series_toggle_{series}"] = series in selected_set


def resolve_manual_text(
    source_mode: str,
    pasted_text: str,
    uploaded_file,
    remote_url: str,
) -> tuple[str, str]:
    if source_mode == "샘플 CSV":
        return DEFAULT_CSV, "샘플 CSV"
    if source_mode == "직접 붙여넣기":
        return pasted_text, "직접 붙여넣기"
    if source_mode == "CSV 업로드":
        if uploaded_file is None:
            return "", "업로드 파일 없음"
        return decode_text_bytes(uploaded_file.getvalue()), uploaded_file.name
    if not remote_url.strip():
        return "", "원격 URL 미입력"
    return fetch_remote_text(remote_url.strip()), remote_url.strip()


inject_styles()

hero_col, action_col = st.columns([5, 1.2])
with hero_col:
    st.markdown(
        f"""
        <div class="hero-card">
            <div class="hero-eyebrow">Mobile-ready market overlay</div>
            <h1 class="hero-title">{APP_TITLE}</h1>
            <p class="hero-copy">
                선행지수, 신용잔고, 코스피·코스닥, 개별 종목을 한 화면에서 비교하는
                모바일 친화형 스트림릿 대시보드입니다. 배포 뒤 아이폰 Safari에서 열고
                홈 화면에 추가하면 앱처럼 테스트하기 좋게 다듬었습니다.
            </p>
            <div class="pill-row">
                <span class="status-pill ok">Yahoo Finance 가격 데이터</span>
                <span class="status-pill note">CSV / 원격 CSV 매크로 입력</span>
                <span class="status-pill note">매크로 시리즈 보간 표시</span>
            </div>
        </div>
        """,
        unsafe_allow_html=True,
    )

with action_col:
    st.markdown("#### 빠른 액션")
    if st.button("캐시 새로고침", use_container_width=True):
        st.cache_data.clear()
        st.rerun()
    st.caption("가격 데이터와 원격 CSV 캐시를 비웁니다.")

if "range_end" not in st.session_state:
    st.session_state.range_end = date.today()
if "range_start" not in st.session_state:
    st.session_state.range_start = years_before(st.session_state.range_end, DATE_PRESET_YEARS[0])

with st.expander("빠른 설정", expanded=True):
    preset_cols = st.columns(len(DATE_PRESET_YEARS))
    for years, column in zip(DATE_PRESET_YEARS, preset_cols):
        if column.button(f"최근 {years}년", key=f"date_preset_{years}", use_container_width=True):
            st.session_state.range_end = date.today()
            st.session_state.range_start = years_before(st.session_state.range_end, years)

    date_cols = st.columns(2)
    date_cols[0].date_input("시작일", key="range_start")
    date_cols[1].date_input("종료일", key="range_end")
    start = st.session_state.range_start
    end = st.session_state.range_end

    if end < start:
        st.error("종료일이 시작일보다 빠를 수는 없습니다.")
        st.stop()

    mode_cols = st.columns(3)
    normalized = mode_cols[0].toggle("첫 시점을 100으로 정규화", value=True)
    scale_mode = mode_cols[1].selectbox(
        "비교 스케일",
        ["자동 균형", "원본 100%", "직접 조정"],
    )
    preset_name = mode_cols[2].selectbox("빠른 프리셋", list(PRESET_OPTIONS.keys()))
    apply_preset = st.button("선택한 프리셋으로 항목 채우기", use_container_width=False)

    tickers_text = st.text_input(
        "실시간 조회 티커",
        value=DEFAULT_TICKERS,
        help="예: ^KS11,^KQ11,005930.KS,218410.KQ",
    )

    source_mode = st.selectbox(
        "매크로 데이터 소스",
        ["샘플 CSV", "CSV 업로드", "직접 붙여넣기", "원격 CSV URL"],
    )
    uploaded = None
    pasted_text = DEFAULT_CSV
    remote_url = ""

    if source_mode == "CSV 업로드":
        uploaded = st.file_uploader("CSV 업로드", type=["csv"])
        st.caption("UTF-8, UTF-8 BOM, CP949, EUC-KR 인코딩을 순서대로 시도합니다.")
    elif source_mode == "직접 붙여넣기":
        pasted_text = st.text_area("CSV 붙여넣기", value=DEFAULT_CSV, height=220)
    elif source_mode == "원격 CSV URL":
        remote_url = st.text_input(
            "원격 CSV URL",
            placeholder="https://raw.githubusercontent.com/.../macro.csv",
        )
        st.caption("GitHub Raw, Google Sheets 공개 CSV, 내부 정적 CSV 링크에 잘 맞습니다.")
    else:
        st.code(DEFAULT_CSV, language="csv")

    st.markdown(f"<p class='section-note'>{HELP_TEXT}</p>", unsafe_allow_html=True)

tickers = tuple(t.strip() for t in tickers_text.split(",") if t.strip())
price_df, live_tickers, failed_tickers = fetch_prices(tickers, start, end)

manual_source_label = "미사용"
manual_preview_text = ""
manual_error = None
try:
    manual_preview_text, manual_source_label = resolve_manual_text(
        source_mode, pasted_text, uploaded, remote_url
    )
    manual_df = parse_user_csv(manual_preview_text)
except (HTTPError, URLError, ValueError, OSError) as exc:
    manual_df = pd.DataFrame()
    manual_error = str(exc)

merged, manual_cols, price_cols = merge_sources(price_df, manual_df, start, end)
all_series = sort_series_names([
    col
    for col in merged.columns
    if pd.to_numeric(merged[col], errors="coerce").notna().any()
])

if merged.empty or not all_series:
    st.warning("표시할 데이터가 없습니다. 티커 또는 매크로 데이터 소스를 확인해 주세요.")
    if manual_error:
        st.error(f"매크로 데이터 오류: {manual_error}")
    st.stop()

default_selected = default_selected_series(all_series)
preset_selected = [col for col in PRESET_OPTIONS[preset_name] if col in all_series]
if not preset_selected:
    preset_selected = default_selected

if "selected_series" not in st.session_state:
    st.session_state.selected_series = default_selected
    sync_series_checkboxes(all_series, default_selected)
else:
    st.session_state.selected_series = [
        col for col in st.session_state.selected_series if col in all_series
    ]
    if not st.session_state.selected_series:
        st.session_state.selected_series = default_selected
    for col in all_series:
        checkbox_key = f"series_toggle_{col}"
        if checkbox_key not in st.session_state:
            st.session_state[checkbox_key] = col in st.session_state.selected_series

if apply_preset:
    st.session_state.selected_series = preset_selected
    sync_series_checkboxes(all_series, preset_selected)

tab_dashboard, tab_data, tab_guide = st.tabs(["대시보드", "데이터", "가이드"])

with tab_dashboard:
    if manual_error:
        st.error(f"매크로 데이터 오류: {manual_error}")

    pills = [
        f"<span class='status-pill ok'>실시간 연결 {len(live_tickers)}개</span>",
        f"<span class='status-pill note'>매크로 소스 {manual_source_label}</span>",
        (
            f"<span class='status-pill warn'>실패 티커 {len(failed_tickers)}개</span>"
            if failed_tickers
            else "<span class='status-pill ok'>티커 조회 이상 없음</span>"
        ),
        (
            "<span class='status-pill note'>정규화 보기</span>"
            if normalized
            else "<span class='status-pill note'>원본 값 보기</span>"
        ),
    ]
    st.markdown(f"<div class='pill-row'>{''.join(pills)}</div>", unsafe_allow_html=True)

    if manual_cols:
        st.info(
            "선행지수·신용잔고 같은 매크로 시리즈는 가격 날짜 축에 맞춰 시간 보간해서, 월별 발표 데이터도 더 촘촘하게 비교할 수 있도록 했습니다."
        )
    if failed_tickers:
        failed_labels = ", ".join(
            f"{ticker} ({reason})" for ticker, reason in failed_tickers.items()
        )
        st.warning(f"일부 티커를 불러오지 못했습니다: {failed_labels}")

    st.markdown("##### 표시할 항목")
    selector_cols = st.columns(2)
    selected = []
    for index, series_name in enumerate(all_series):
        checkbox_key = f"series_toggle_{series_name}"
        with selector_cols[index % 2]:
            if st.checkbox(label_name(series_name), key=checkbox_key):
                selected.append(series_name)
    st.session_state.selected_series = selected
    if not selected:
        st.info("표시할 항목을 하나 이상 선택해 주세요.")
        st.stop()

    working = merged[selected].copy()
    if normalized:
        working = normalize_df(working, selected)
    auto_scales = auto_fit_scales(merged[selected], selected, normalized)

    scale_values: dict[str, int] = {}
    if scale_mode == "직접 조정":
        with st.expander("직접 배율 조정", expanded=False):
            action_a, action_b = st.columns(2)
            if action_a.button("자동값 채우기", use_container_width=True):
                for col in selected:
                    st.session_state[f"scale_{col}"] = int(round(auto_scales.get(col, 100)))
            if action_b.button("모두 100%", use_container_width=True):
                for col in selected:
                    st.session_state[f"scale_{col}"] = 100

            slider_cols = st.columns(2)
            for index, col in enumerate(selected):
                slider_key = f"scale_{col}"
                if slider_key not in st.session_state:
                    st.session_state[slider_key] = int(round(auto_scales.get(col, 100)))
                with slider_cols[index % 2]:
                    scale_values[col] = st.slider(
                        f"{label_name(col)} 비율 (%)",
                        min_value=5,
                        max_value=5000,
                        step=1,
                        key=slider_key,
                    )
    elif scale_mode == "자동 균형":
        scale_values = {col: int(round(auto_scales.get(col, 100))) for col in selected}
    else:
        scale_values = {col: 100 for col in selected}

    plot_df = working.copy()
    for col in selected:
        plot_df[col] = centered_scale(
            pd.to_numeric(plot_df[col], errors="coerce"),
            scale_values[col],
            normalized,
        )

    metric_rows = chunk_list(selected[: min(len(selected), 6)], 3)
    for row in metric_rows:
        metric_cols = st.columns(len(row))
        for column, series_name in zip(metric_cols, row):
            snapshot = series_snapshot(working[series_name])
            if snapshot is None:
                column.metric(label_name(series_name), "데이터 없음", delta_color="off")
                continue
            latest_date, latest_value, previous_value = snapshot
            source_text = "매크로" if series_name in manual_cols else "실시간"
            column.metric(
                label_name(series_name),
                format_value(latest_value),
                format_delta(None if previous_value is None else latest_value - previous_value),
                delta_color="off",
                help=f"{source_text} 데이터 | 최근 반영 {latest_date.date().isoformat()}",
            )

    figure = go.Figure()
    for index, col in enumerate(selected):
        is_manual = col in manual_cols
        figure.add_trace(
            go.Scatter(
                x=plot_df.index,
                y=plot_df[col],
                mode="lines",
                name=label_name(col),
                line=dict(
                    color=COLORWAY[index % len(COLORWAY)],
                    width=3.2 if is_manual else 2.4,
                    shape="linear",
                ),
                hovertemplate="%{x|%Y-%m-%d}<br>%{y:,.2f}<extra>%{fullData.name}</extra>",
            )
        )

    figure.update_layout(
        template="plotly_white",
        height=680,
        margin=dict(l=18, r=18, t=26, b=18),
        paper_bgcolor="rgba(0, 0, 0, 0)",
        plot_bgcolor="rgba(255, 255, 255, 0.72)",
        hovermode="x unified",
        legend=dict(
            orientation="h",
            yanchor="bottom",
            y=1.02,
            xanchor="left",
            x=0,
            title=None,
        ),
        xaxis_title=None,
        yaxis_title="비교 지수" if normalized else "값",
        font=dict(
            family="Apple SD Gothic Neo, Pretendard, Segoe UI, sans-serif",
            color="#173022",
        ),
    )
    figure.update_xaxes(
        showgrid=False,
        showspikes=True,
        spikecolor="rgba(29, 95, 74, 0.16)",
        spikemode="across",
        spikesnap="cursor",
    )
    figure.update_yaxes(
        showgrid=True,
        gridcolor="rgba(23, 48, 34, 0.08)",
        zeroline=False,
    )

    st.plotly_chart(
        figure,
        use_container_width=True,
        config={
            "displaylogo": False,
            "responsive": True,
            "modeBarButtonsToRemove": ["lasso2d", "select2d"],
        },
    )

with tab_data:
    info_cols = st.columns(2)
    with info_cols[0]:
        st.markdown(
            f"""
            <div class="source-card">
                <h4>매크로 데이터 소스</h4>
                <p>{manual_source_label}</p>
            </div>
            """,
            unsafe_allow_html=True,
        )
    with info_cols[1]:
        st.markdown(
            f"""
            <div class="source-card">
                <h4>실시간 티커 상태</h4>
                <p>성공 {len(live_tickers)}개 / 실패 {len(failed_tickers)}개</p>
            </div>
            """,
            unsafe_allow_html=True,
        )

    if manual_preview_text:
        with st.expander("매크로 입력 미리보기", expanded=False):
            st.code(manual_preview_text[:5000], language="csv")

    if failed_tickers:
        with st.expander("실패한 티커 상세", expanded=False):
            failure_df = pd.DataFrame(
                [{"ticker": ticker, "reason": reason} for ticker, reason in failed_tickers.items()]
            )
            st.dataframe(failure_df, use_container_width=True)

    preview = merged[st.session_state.selected_series].copy().reset_index()
    preview = preview.rename(
        columns={column: label_name(column) for column in preview.columns if column != "date"}
    )
    st.subheader("현재 선택 데이터")
    st.dataframe(preview.tail(180), use_container_width=True)
    st.download_button(
        "현재 선택 데이터 CSV 다운로드",
        data=merged[st.session_state.selected_series].to_csv(encoding="utf-8-sig").encode("utf-8-sig"),
        file_name=f"thinkstock_export_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv",
        mime="text/csv",
        use_container_width=False,
    )

with tab_guide:
    st.markdown(GUIDE_MARKDOWN)
    with st.expander("샘플 CSV 템플릿", expanded=False):
        st.code(DEFAULT_CSV, language="csv")

