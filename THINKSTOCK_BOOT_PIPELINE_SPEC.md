---
title: ThinkStock Boot Pipeline Specification
document_type: ai_handoff_implementation_spec
status: proposed
handoff_target: "0.30 작업방"
product: ThinkStock
source_of_truth_ui: docs/
local_entrypoint: run_local_pages.bat
remote_entrypoint: https://eg-tools.github.io/ThinkStock/
prepared_date: 2026-09-04
current_boot_complexity: complex
target_boot_complexity: moderate
---

# ThinkStock 부팅·데이터·계산 파이프라인 명세

## 1. 목적과 논의 맥락

이 문서는 ThinkStock 부팅 구조를 개선하기 위한 AI 구현 명세다. 다음 요구에서 출발했다.

- 종목 가격을 받을 때 거래량도 같은 종목·날짜 기준으로 준비한다.
- 동행율은 대상 종목, 코스피, 코스닥이 준비된 뒤 계산한다.
- 신호는 가격·거래량과 필요한 거시·보조지표가 준비된 뒤 계산한다.
- 공시와 내부거래는 DART 상태가 확정된 뒤 계산한다.
- EPS는 DART 실제치와 네이버 분기 실적·추정치를 병렬 수집한 뒤 병합한다.
- AI는 자신이 실제 사용하는 필수 입력이 준비되고 기능이 ON일 때만 계산한다.
- 검증된 캐시는 재부팅 즉시 사용하고 변경된 자료만 갱신한다.
- 데이터 응답 순서가 달라도 같은 입력에서는 같은 결과가 나와야 한다.

핵심 목적은 단순히 부팅 시간을 줄이는 것이 아니다. **비동기 응답 순서에 따라 계산 결과가 달라지지 않도록 만드는 것**이 우선이다.

이 문서에서 `MUST`, `MUST NOT`, `SHOULD`, `MAY`는 각각 필수, 금지, 권장, 선택을 뜻한다.


## 2. 복잡도 판단

### 2.1 현재 구조: 복잡

현재 부팅은 셋 중 `복잡`에 해당한다.

| 원인 | 설명 |
|---|---|
| 데이터 원천 | 가격, 거래량, 지수, 거시, 신용, ADR, 위기, DART, 네이버, AI 모델 |
| 갱신 주기 | 실시간성 가격부터 거의 변하지 않는 과거 EPS까지 서로 다름 |
| 실행 조건 | 기능별 ON/OFF와 보이는 종목에 따라 필요한 작업이 달라짐 |
| 캐시 | 런타임 스냅샷, seed, IndexedDB, 로컬 미러, 원격 최신 확인이 공존 |
| 비동기 제어 | 취소, 재시도, 늦은 응답, 부분 실패, 중복 계산을 관리해야 함 |
| 화면 | 차트는 빨리 열어야 하지만 신호와 AI는 완성된 입력을 기다려야 함 |

복잡성 자체가 모두 불필요한 것은 아니다. 제품 요구의 본질적인 복잡성은 `적당` 수준이다. 목표는 기능을 줄여 억지로 단순하게 만드는 것이 아니라, 다음 세 가지로 제어 흐름을 `적당` 수준으로 낮추는 것이다.

1. 하나의 부팅 세대
2. 하나의 기능 의존성 표
3. 하나의 원자적 커밋 경로

### 2.2 문서 단순화 원칙

이 문서는 같은 조건을 여러 장에서 반복하지 않는다. 기능별 필수 입력은 **5장의 의존성 표를 단일 기준**으로 사용한다.


## 3. 저장소와 제품 제약

- 사용자용 앱은 `docs/`의 공용 웹 앱 하나만 사용한다.
- 로컬과 GitHub Pages의 UI와 기능 의미는 같아야 한다.
- 로컬 실행은 `run_local_pages.bat`와 `scripts/local_pages_server.mjs`를 사용한다.
- 비밀키는 공개 번들에 포함하면 안 된다.
- 별도 Streamlit, 네이티브 iOS 또는 대체 UI를 만들지 않는다.
- 메인 차트가 보이는 X 범위의 유일한 소유자다.
- 연결 차트, 마커, EPS, AI 오버레이는 메인 범위를 소비해야 한다.
- 포인터·휠·핀치·리사이즈·드래그 입력은 최신 애니메이션 프레임으로 합친다.
- 로컬/배포, 데스크톱/iPhone 경로를 함께 검증한다.
- 구현 전 기존 계약과 재사용 가능한 모듈을 먼저 확인한다.
- 공통화 경계가 동작이나 성능을 바꾸면 편집 전에 사용자와 확인한다.
- 로컬 앱 버전은 기능 작업 시작 시 한 번만 올리고 검증·배포 수정 동안 유지한다.


## 4. 핵심 상태 모델

### 4.1 부팅 세대

한 번의 부팅 또는 전체 재초기화마다 `bootGeneration`을 만든다.

- 새 세대가 시작되면 이전 네트워크·Worker·예약 렌더를 취소한다.
- 취소하지 못한 이전 결과가 늦게 도착하면 커밋하지 않는다.
- 모든 요청, 계산, 커밋은 자신이 속한 세대를 확인한다.

### 4.2 데이터 revision

각 데이터 그룹은 변경 번호 또는 안정적인 내용 지문을 가진다.

```text
priceRevision       volumeRevision      indexRevision
macroRevision       creditRevision      crisisRevision
adrRevision         disclosureRevision  insiderRevision
actualEpsRevision   estimateEpsRevision aiContextRevision
```

파생 결과는 계산에 사용한 revision 묶음을 기록한다. 계산 완료 시 현재 revision과 다르면 결과를 폐기한다.

### 4.3 원천 상태

| 상태 | 의미 |
|---|---|
| `IDLE` | 아직 요청하지 않음 |
| `LOADING` | 수집 중 |
| `READY` | 최신성·형식·무결성 검증 완료 |
| `CACHED` | 정책상 사용할 수 있는 검증 캐시, 최신 확인 상태는 별도 기록 |
| `EMPTY` | 정상 응답이지만 데이터 0건 |
| `DEGRADED` | 일부 선택 입력 없이 제한 사용 가능 |
| `UNAVAILABLE` | 필수 입력을 확보하지 못함 |
| `FAILED` | 요청 또는 검증 오류 |

`Resolved`는 `READY`, `CACHED`, `EMPTY`, `DEGRADED`, `UNAVAILABLE`, `FAILED` 중 하나로 끝났다는 뜻이다. 요청 완료만으로 `READY`가 되면 안 된다.

`Usable`은 검증된 `READY`, 정책상 유효한 `CACHED`, 또는 해당 기능이 명시적으로 허용한 `DEGRADED`를 뜻한다.

### 4.4 사용자 사용 가능 단계

| 단계 | 상태 | 의미 |
|---|---|---|
| 1 | `CHART_READY` | 메인 가격 차트와 기본 탐색 사용 가능 |
| 2 | `MARKET_READY` | 동행율·시장 신호 입력 상태 확정 |
| 3 | `COMPANY_READY` | 공시·내부거래·EPS 입력 상태 확정 |
| 4 | `GLOBAL_READY` | 모든 ON 기능이 최종 상태이며 현재 revision과 일치 |

상위 단계가 늦거나 실패해도 준비된 하위 단계는 사용할 수 있어야 한다.


## 5. 기능 의존성 표 — 단일 기준

| 기능 | 실행 조건 | 필수 입력 | 선택 입력 | 계산 시점 |
|---|---|---|---|---|
| 메인 차트 | 항상 | 보이는 종목 가격, Plotly | 거래량 | 가격과 차트 엔진 준비 즉시 |
| 동행율 | ON | 대상 가격, 코스피, 코스닥, 같은 기준 기간 | 없음 | 세 입력이 usable일 때 한 번 |
| 시장 신호 | ON | 전체 가격, 대상 거래량, 코스피·코스닥, 거시, 신용, 위기, 변동성, ADR, 공포탐욕 상태 | 없음 | 모든 필수 상태 확정 후 정책에 따라 계산 또는 unavailable |
| 공시 | ON | DART 기업코드, 공시 결과 | 캐시 seed | 접수번호 중복 제거와 분류 후 |
| 내부거래 | ON | DART 기업코드, 내부거래 결과 | 없음 | 보이는 종목 요청 종료와 동일인·동일일 상계 후 |
| EPS | ON 또는 AI가 요구 | DART 실제 EPS 상태, 네이버 분기 실적·추정 상태 | 연간 기반 분기 보완값 | 두 원천 join·검증·병합 후 |
| AI | ON | 전체 가격, 코스피·코스닥, 거시, 신용, 위기, 변동성, ADR·공포탐욕 상태, AI 시장 모델, 기업 분석·실적, AI가 사용하는 공시 상태 | 증권사 리포트 등 명시된 보강 자료 | 필수 상태 확정 및 `aiInputRevision` 고정 후 |

추가 규칙:

- 새 가격 네트워크 응답은 가능한 한 `{date, close, volume}`을 같은 단위로 제공·저장한다.
- 런타임 스냅샷에 가격만 있고 거래량이 늦게 복원되면 차트는 먼저 표시할 수 있다.
- 거래량이 필요한 신호는 전체 거래량 이력과 최소 표본 조건을 충족하기 전 계산하면 안 된다.
- 현재 AI가 거래량을 직접 사용하지 않으면 AI 거래량 조건은 `NOT_REQUIRED`로 끝낸다.
- AI 입력 키에 공시가 포함되는 동안 DART 공시 상태도 계산 전에 `Resolved`되어야 한다.
- 증권사 리포트는 선택 입력이며 기본 AI를 무한 대기시키면 안 된다.


## 6. 목표 부팅 순서

```text
Phase 0  bootGeneration 생성 · 이전 작업 취소
Phase 1  설정, ON/OFF, 보이는 종목 복원
Phase 2  검증된 캐시와 마지막 정상 화면 복원
Phase 3  필요한 네트워크 요청을 우선순위 차선에서 병렬 시작
Phase 4  메인 차트 장벽 통과 즉시 CHART_READY
Phase 5  기능별 독립 장벽 통과 순서대로 계산
Phase 6  조정된 단일 렌더 경로로 결과 반영
Phase 7  모든 ON 기능 상태 확정 후 GLOBAL_READY
Phase 8  숨은 종목, 캐시 감사 등 저우선순위 작업
```

### 6.1 Phase 3 병렬 차선

```text
검증 캐시 복원
    ↓
┌───────────────────────────────────────────────┐
│ 최우선: 보이는 종목 가격·거래량, 지수, Plotly │
│                                               │
│ 분석: 거시, 신용, 위기·변동성, ADR, 공포탐욕 │
│       AI 시장 모델                            │
│                                               │
│ 조건부: DART 공시·내부거래                    │
│         DART 실제 EPS + 네이버 추정치          │
│         기업 분석, 선택적 증권사 리포트        │
└──────────── 네트워크 요청 병렬 시작 ──────────┘
```

권장 초기 제한:

- 전체 일반 네트워크 요청: 최대 4개부터 계측
- 가격·지수용 슬롯: 항상 우선 보장
- DART 다년도·다종목 요청: 최대 1~2개 별도 차선
- 보이는 종목 AI 기업 분석: 최대 2개
- CPU를 많이 쓰는 신호·AI 계산: 무제한 동시 실행 금지

고정된 숫자가 정답은 아니다. 로컬 PC와 iPhone WebKit 측정 결과로 조정한다.

### 6.2 기능별 독립 장벽

모든 supplemental 원천을 하나의 큰 `Promise.all`로 기다리지 않는다.

```text
chartGate      = price + Plotly
coMovementGate = target price + KOSPI + KOSDAQ
signalGate     = price + volume + indices + macro + credit
                 + crisis + volatility + ADR/fear-greed
epsGate        = DART actual EPS + Naver quarterly data
aiGate         = AI 필수 입력 계약 전체
```

느린 DART 공시가 공시와 무관한 시장 신호를 막으면 안 된다. 반대로 AI가 공시를 실제 입력으로 사용한다면 AI만 DART 상태를 기다린다.


## 7. 병렬 수집과 원자적 반영

### 7.1 공통 처리 순서

```text
fetch in parallel
    → validate each result
    → normalize each result
    → merge in memory
    → verify merged result
    → confirm bootGeneration and input revisions
    → commit state once
    → persist cache once
    → request render once
```

수집 함수는 가능한 한 공용 상태를 직접 수정하지 않고 결과를 반환해야 한다.

### 7.2 공유 보조지표

ADR, 공포탐욕, VKOSPI, VIX는 병렬 요청할 수 있지만 겹치는 보조지표 행이나 revision을 수정할 수 있다.

```text
fetchAdr() ─────────────┐
fetchFearGreed() ───────┤
fetchCrisisVolatility() ┘
          ↓
mergeAuxiliarySources() 한 번
          ↓
commit + cache + render 한 번
```

각 작업이 같은 `appData`를 읽고 독립 저장하는 naive `Promise.all`은 금지한다.

### 7.3 최종 화면 반영

```text
메인 가격 차트
    → 준비된 동행율·시장 신호
    → 준비된 공시·내부거래
    → 준비된 EPS·AI
    → 기존 X 범위 유지
    → 자동 Y 맞춤
    → 핸들·마커·연결 차트 동기화
```

각 기능이 독립적으로 메인 X 범위를 변경하면 안 된다.


## 8. 캐시 정책

### 8.1 공통 메타데이터

캐시는 최소한 다음을 기록한다.

```text
source, ticker, firstDate, latestDate, checkedAt,
contractVersion, contentFingerprint, qualityState
```

자료마다 최신성 정책이 달라야 한다.

- 가격: 예상 최신 거래일
- ADR·신용: 원천의 정상 발표 지연
- 월간·분기 거시지표: 공식 발표 주기
- DART: 접수번호와 정정공시
- 추정치: 짧은 TTL과 `asOfDate`

모든 데이터를 주가 최신 거래일과 비교하면 안 된다.

### 8.2 캐시 우선 갱신

```text
검증 캐시 즉시 복원
    → 기존 화면 또는 결과 사용
    → 최신 원천 확인
        ├─ 내용 지문 동일: 재계산 생략
        └─ 내용 지문 변경: 영향받는 기능만 한 번 재계산
```

### 8.3 EPS 분리 캐시

`actualEpsCache`:

- 주 원천: DART
- 과거 실제치 장기 보관
- 새 분기, 새 사업보고서, 정정공시, 계약 변경 때만 관련 범위 갱신
- 같은 기간은 DART 실제치가 다른 원천보다 우선

`estimateEpsCache`:

- 주 원천: 네이버
- 미래 분기 추정치
- 짧은 TTL로 갱신
- 실제치 발표 시 같은 기간 추정치를 교체

EPS 병합 우선순위:

```text
DART 실제치
    > 네이버 실제치
    > 명시적 네이버 분기 추정치
    > 연간 자료에서 계산한 분기 보완값
```

재부팅 시 과거 전체를 다시 요청하지 않는다. 최신 실제 기간, EPS 값, DART 접수번호, 보고서 종류, 연결·별도 기준과 내용 지문을 확인하고 변경된 사업연도 또는 새 분기만 받는다.

4분기 EPS를 연간 누적값에서 1~3분기를 빼서 구한다면 사업보고서 공개 시 해당 사업연도 전체를 재검증한다.


## 9. 실패·취소·부분 사용 정책

- 필수 원천 하나가 늦어도 앱 전체를 무한 `LOADING`으로 두지 않는다.
- 원천별 제한 시간 후 `DEGRADED`, `UNAVAILABLE`, `FAILED`로 확정한다.
- 정상 0건은 `EMPTY`, 요청 실패는 `FAILED` 또는 `UNAVAILABLE`이다.
- 한 기능의 실패가 의존하지 않는 다른 기능을 막으면 안 된다.
- 새 부팅, 종목 변경, 기능 OFF 시 관련 이전 작업을 취소한다.
- 네트워크 재시도는 408, 425, 429, 5xx와 일시적 연결 오류에 한정한다.
- 400, 401, 403, 404, 형식·검증 오류를 맹목적으로 재시도하지 않는다.
- 선택 입력은 정해진 soft wait 이후 없어도 기본 기능을 진행할 수 있다.


## 10. AI 계산 규칙

```text
aiEnabled
AND everyRequiredAiSource.isResolved
AND requiredSourcesAreUsableByPolicy
AND aiMarketModelResolved
    → freeze aiInputRevision
    → reuse cache or calculate once
```

- AI가 실제 사용하는 모든 입력은 캐시 키의 내용 지문에 포함한다.
- 시각적 차트 변경만으로 AI를 재계산하지 않는다.
- 최신 확인 후 지문이 같으면 기존 AI 결과를 유지한다.
- 입력이 바뀌면 영향받는 종목만 재계산한다.
- 계산 중 revision이 바뀌면 이전 결과를 폐기한다.
- 선택 입력이 늦게 도착하면 짧은 정착 시간 동안 모아 최대 한 번 보강 계산한다.
- 결과에는 사용한 자료의 최신일, revision, 누락된 선택 입력을 기록한다.


## 11. 사용자 상태 표시

권장 표시 예:

```text
차트 사용 가능 · 분석 자료 준비 중

차트 READY
동행율 READY
신호 READY
공시 CACHED · 최신 확인 중
내부거래 EMPTY
EPS READY
AI OFF
```

모든 ON 기능이 종료 상태가 되면 `ThinkStock 준비 완료`를 표시한다. 실패나 제한 결과를 정상 결과처럼 조용히 표시하면 안 된다.


## 12. 현재 구현에서 확인된 상태

| 영역 | 현재 상태 | 목표 변경 |
|---|---|---|
| seed 복원 | 가격·거시·신용·ADR·VKOSPI·공시 병렬 읽기 | 유지 |
| 핵심 최신 갱신 | 가격과 지수 병렬 | 유지 |
| supplemental 최신 갱신 | 핵심 완료 후 시작, 부팅 중 최대 2개 | 네트워크 요청은 더 일찍 시작하고 가격 우선 슬롯 유지 |
| supplemental 완료 | 묶음 완료 후 파생 입력 ready | 기능별 독립 장벽으로 분리 |
| 동행율 | 지수를 우선 준비하지만 명시적 동일 revision 장벽이 약함 | 대상·코스피·코스닥 장벽 명시 |
| 시장 신호 | 가격·거래량·거시·신용·ADR 확인이 비교적 강함 | 위기·변동성 상태까지 명시하고 revision 통일 |
| 공시 | 캐시/seed 우선 표시 후 DART 페이지별 점진 갱신 | 중간 상태를 명시하고 최종 분류·마커는 조정 반영 |
| 내부거래 | DART 후 병합·상계 구조에 가까움 | 종료 상태와 revision 명시 |
| EPS | 네이버 다음 DART의 직렬 경로와 공유 레코드 갱신 가능성 | 두 원천 병렬 fetch, 단일 merge·commit |
| AI 준비 | 과거자료·기업분석·시장모델은 병렬 | 거시·신용·위기·ADR·공시의 명시적 입력 장벽 추가 |
| AI 실행 가능 판정 | 주로 가격 이력 길이 중심 | 실제 사용 원천 전체의 resolved/usable 정책 적용 |
| 스냅샷 | 가격은 빠르지만 큰 거래량 이력은 별도 수화 | 차트와 신호 준비 단계를 분리 |


## 13. 예상 효과와 비용

| 항목 | 예상 변화 |
|---|---|
| 계산 일관성 | 매우 크게 향상 |
| 재부팅 체감 속도 | 크게 향상 가능 |
| 최초 부팅 속도 | 중간 수준 개선 예상 |
| API 호출량 | 감소 |
| 중복 계산·렌더 | 감소 |
| 오류 추적 | 쉬워짐 |
| 구조 복잡도 | 초기 구현 시 증가하지만 제어 흐름은 명확해짐 |

성능 개선 폭은 측정 전 단정하지 않는다. 핵심 성공 기준은 **같은 입력에서 같은 결과**, **불필요한 전체 재수집 없음**, **차트 우선 사용 가능**이다.


## 14. 예상 중심 파일

구현 전 호출 계약을 다시 추적한다.

- `docs/app.js`
- `docs/modules/app-bootstrap-orchestrator.mjs`
- `docs/modules/runtime-data-app.mjs`
- `docs/modules/runtime-refresh-orchestrator.mjs`
- `docs/modules/runtime-market-refresh.mjs`
- `docs/modules/data-seed-loader.mjs`
- `docs/modules/ticker-price-runtime.mjs`
- `docs/modules/chart-marker-runtime.mjs`
- `docs/modules/market-timing-service.mjs`
- `docs/modules/ai-forecast-traces.mjs`
- `docs/modules/ai-forecast.js`
- `docs/modules/ai-analysis-cache.mjs`
- `docs/modules/eps-chart.mjs`
- `docs/modules/dart-request-runtime.mjs`
- `shared/company-analysis-contract.mjs`
- `worker/src/company-analysis.mjs`


## 15. 구현 완료 조건

- [ ] 메인 차트는 분석 원천을 기다리지 않고 먼저 사용할 수 있다.
- [ ] 가격 네트워크 자료는 거래량을 같은 종목·날짜 기준으로 제공·저장한다.
- [ ] 신호는 전체 거래량과 모든 필수 시장 입력 상태가 확정되기 전에 계산하지 않는다.
- [ ] 동행율은 대상·코스피·코스닥이 같은 분석 세대일 때만 계산한다.
- [ ] 거시·신용·위기·ADR·공포탐욕 요청은 가격 우선순위를 침해하지 않는 범위에서 조기 병렬 시작한다.
- [ ] supplemental 전체가 아니라 기능별 장벽으로 계산을 시작한다.
- [ ] 공유 보조지표 병렬 응답이 서로를 덮어쓰지 않는다.
- [ ] EPS의 DART와 네이버 요청이 병렬이며 merge·save·render는 각각 한 번이다.
- [ ] 실제 EPS와 추정 EPS의 캐시 수명이 분리된다.
- [ ] AI는 실제 사용 필수 입력이 resolved되기 전에 새 계산을 시작하지 않는다.
- [ ] AI 입력 지문이 같으면 재계산하지 않는다.
- [ ] 이전 bootGeneration 결과가 최신 상태를 덮어쓰지 않는다.
- [ ] 기능 OFF 시 전용 요청·계산을 취소하거나 시작하지 않는다.
- [ ] 실패한 기능은 무한 로딩 없이 명시적 최종 상태가 된다.
- [ ] 한 기능의 실패가 독립 기능을 막지 않는다.
- [ ] 상태 커밋, 캐시 저장, 렌더가 불필요하게 반복되지 않는다.


## 16. 필수 검증 시나리오

1. 완전한 캐시가 있는 동일 날짜 재부팅
2. 가격 스냅샷은 있지만 거래량 캐시가 늦는 부팅
3. 코스피만 준비되고 코스닥이 늦는 동행율
4. 거시·신용·위기·ADR의 완료 순서를 바꾸는 반복 실행
5. 보조지표 하나가 실패하거나 정상 0건인 실행
6. ADR·공포탐욕·VKOSPI·VIX가 동시에 도착하는 실행
7. 느린 DART가 시장 신호를 불필요하게 막지 않는지 확인
8. 네이버가 빠르고 DART가 느린 EPS 수집
9. DART가 빠르고 네이버가 느린 EPS 수집
10. EPS 한 원천 실패와 두 원천 동시 완료
11. 실제 EPS 경계 동일, 새 분기, 정정공시, 연말 4분기 재검증
12. 거시 입력이 `LOADING`일 때 AI가 새 계산을 시작하지 않는지 확인
13. 최신 확인 지문이 같을 때 신호·AI 재계산 생략
14. 계산 도중 종목 변경, 기능 OFF, 새 부팅 시작
15. 입력 revision당 계산·저장·렌더 횟수 확인
16. 데스크톱과 iPhone에서 동시 실행 제한과 입력 반응성 확인
17. 로컬 서버와 GitHub Pages의 동일 기능 결과 확인

구현 후 관련 단위 테스트, 전체 웹 JavaScript 검사, 웹 번들 빌드, 로컬 부팅, Safari/iPhone WebKit을 모두 검증한다.


## 17. 0.30 작업방 구현 지시

1. 이 문서를 전면 재작성 지시로 해석하지 말고 기존 계약과 모듈을 먼저 조사한다.
2. 5장의 의존성 표를 단일 기준으로 삼는다.
3. 현재 병렬 복원·요청 레지스트리·취소·재시도 기능은 재사용한다.
4. 먼저 기능별 장벽과 상태 관찰을 추가하고, 그다음 네트워크 시작 시점을 앞당긴다.
5. 수집 함수의 공유 상태 변경을 단계적으로 순수 결과 반환 방식으로 옮긴다.
6. 가격 우선 표시가 느려지지 않았는지 계측한다.
7. 변경 전후의 부팅 시간보다 계산 횟수, 캐시 적중, 원천 대기, 결과 revision을 함께 비교한다.
8. 모든 완료 조건과 검증 시나리오가 통과하기 전 배포하지 않는다.
