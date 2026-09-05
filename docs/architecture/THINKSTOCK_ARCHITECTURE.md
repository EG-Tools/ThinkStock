# ThinkStock Architecture

이 문서는 현재 저장소 코드에서 확인되는 실행 구조를 Mermaid로 표현한다. `THINKSTOCK_BOOT_PIPELINE_SPEC.md`의 제안 사항은 실제 코드에서 확인된 범위만 반영하며, 목표 구조를 현재 구조로 단정하지 않는다.

## 1. 실행 환경과 데이터 경계

```mermaid
flowchart TD
    User[PC 또는 iPhone 사용자]

    subgraph Browser[공용 웹 앱 - docs]
        UI[화면과 사용자 입력]
        Boot[부팅 및 새로고침 조정]
        State[앱 상태와 검증 캐시]
        Chart[메인 차트 조정]
        Aux[보조차트]
        Features[동행율 · 신호 · 공시 · 내부거래 · EPS · AI]
        UI --> Boot
        Boot <--> State
        State --> Chart
        State --> Features
        Chart --> Aux
        Features --> Chart
    end

    subgraph Local[로컬 실행]
        LocalServer[local_pages_server]
        Mirror[검증된 로컬 데이터 미러]
        LocalServer <--> Mirror
    end

    subgraph Remote[배포 실행]
        Pages[GitHub Pages 정적 앱과 분할 데이터]
        Gateway[Cloudflare Worker 보호 API]
    end

    subgraph Sources[외부 데이터 원천]
        Market[KRX · 네이버 · Yahoo]
        Finance[DART · KOFIA · INDEXerGO]
        Macro[ECOS · FRED · Stockplus]
        Research[네이버 · 한경 리서치]
    end

    User --> Browser
    Boot -->|로컬 API와 정적 파일| LocalServer
    Boot -->|배포 정적 파일| Pages
    Boot -->|배포 보호 요청| Gateway
    LocalServer --> Sources
    Gateway --> Sources
```

핵심 규칙은 로컬과 배포가 서로 다른 제품을 갖는 것이 아니라, 동일한 `docs/` 앱이 데이터 접근 경계만 달리 사용한다는 것이다. 비밀키가 필요한 요청은 로컬 서버 또는 Worker 밖으로 노출하지 않는다.

## 2. 부팅과 최신 데이터 결합

```mermaid
flowchart TD
    Start[앱 시작]
    Restore[설정 · ON/OFF · 보이는 종목 복원]
    Cache[검증 캐시와 정적 seed 복원]
    Plan[필요한 최신 확인 계획 수립]

    subgraph Lanes[우선순위별 비동기 작업]
        Critical[최우선: 보이는 가격 · 거래량 · 코스피 · 코스닥]
        Analysis[분석 입력: 거시 · 신용 · 변동성 · ADR · 공포탐욕]
        Conditional[조건부: 공시 · 내부거래 · EPS · AI 자료]
    end

    Merge[검증 → 정규화 → 메모리 병합]
    Commit[현재 세대와 revision 확인 후 한 번 커밋]
    ChartReady[메인 차트 사용 가능]
    Gates{기능별 필수 입력 준비?}
    Derived[동행율 · 신호 · EPS · AI 등 필요한 계산]
    Render[조정된 단일 렌더 요청]
    Ready[켜진 기능의 최종 상태 확정]

    Start --> Restore --> Cache --> Plan
    Plan --> Critical
    Plan --> Analysis
    Plan --> Conditional
    Cache --> ChartReady
    Critical --> Merge
    Analysis --> Merge
    Conditional --> Merge
    Merge --> Commit
    Commit --> ChartReady
    Commit --> Gates
    Gates -->|준비됨| Derived --> Render --> Ready
    Gates -->|OFF 또는 입력 불충분| Ready
```

캐시가 있으면 먼저 화면을 복원하고, 네트워크 응답은 검증과 병합을 거친 뒤 변경된 자료만 반영한다. 기능별 계산은 하나의 거대한 대기열이 아니라 각 기능이 실제로 요구하는 입력이 준비된 시점에 시작한다.

## 3. 차트·뷰포트·마커 관계

```mermaid
flowchart TD
    Input[마우스 · 휠 · 터치 · 빠른 기간 버튼]
    Viewport[메인 뷰포트 상태]
    Frame[최신 프레임 입력으로 병합]
    Coordinator[차트 업데이트 조정자]

    subgraph Main[메인 차트 프레임]
        Range[X 범위 확정]
        Scale[보이는 모든 시계열의 자동 Y 맞춤]
        Series[가격 · 거시 · EPS · AI 시계열]
        Marker[날짜와 소유 시계열에서 파생된 마커]
        Hover[현재 포인터 기준 정보창]
    end

    subgraph Linked[연결된 소비자]
        Handles[좌우 스케일 핸들]
        Indicators[켜진 보조차트]
        Cursor[공통 날짜 커서]
    end

    Input --> Viewport --> Frame --> Coordinator
    Coordinator --> Range
    Coordinator --> Scale
    Range --> Series
    Scale --> Series
    Series --> Marker
    Series --> Hover
    Range --> Handles
    Range --> Indicators
    Range --> Cursor
    Coordinator -->|입력 종료 후 필요한 확정 렌더 한 번| Main
```

메인 뷰포트가 보이는 시간 범위를 소유한다. 보조차트와 커서는 같은 범위를 소비하고, 공시·내부거래·신호 마커는 별도 화면 좌표를 기억하지 않고 소유 시계열의 날짜와 값에서 위치를 얻는 것이 기준이다.

## 근거 파일

- `AGENTS.md`
- `package.json`
- `THINKSTOCK_BOOT_PIPELINE_SPEC.md`
- `docs/modules/app-bootstrap-orchestrator.mjs`
- `docs/modules/runtime-refresh-orchestrator.mjs`
- `docs/modules/runtime-data-app.mjs`
- `docs/modules/chart-update-coordinator.mjs`
- `docs/modules/chart-viewport-controller.mjs`
- `docs/modules/chart-marker-runtime.mjs`
- `docs/modules/auxiliary-chart-runtime.mjs`
- `docs/modules/market-timing-service.mjs`
- `scripts/local_pages_server.mjs`
- `worker/src/index.mjs`
