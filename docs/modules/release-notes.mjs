const SOURCE_BYTES = typeof __THINKSTOCK_RELEASE_NOTES_BYTES__ !== "undefined"
    ? Math.max(0, Number(__THINKSTOCK_RELEASE_NOTES_BYTES__) || 0)
    : 0;
  const RELEASES = Object.freeze([
    Object.freeze({
      version: "3.31",
      date: "2026.08.30",
      items: Object.freeze([
        "종목탐구 성공 결과와 전체 신호 캐시 재사용",
        "변경·신규 종목만 계산하는 빠른 재검색",
        "실패 종목 중복 대기 제거와 단계별 재시도",
        "추출 실패 수의 검색 완료 요약 유지",
      ]),
    }),
    Object.freeze({
      version: "3.30",
      date: "2026.08.30",
      items: Object.freeze([
        "AI·EPS 클릭 전용 로딩과 부팅 작업 축소",
        "공시·내부거래 부팅 완료 후 진행 복원",
        "부가기능 OFF 상태의 종목 보조작업 제거",
        "5개 차트 기준 성능 정책과 새로고침 도움말 배치 개선",
      ]),
    }),
    Object.freeze({
      version: "3.29",
      date: "2026.08.30",
      items: Object.freeze([
        "부팅 완료 직후 비필수 작업 안정 구간 추가",
        "사용자 요청 작업과 백그라운드 작업 우선순위 분리",
        "동일 데이터 재적용 차단과 연쇄 재계산 축소",
        "차트·데이터 갱신 성능 진단 보강",
      ]),
    }),
    Object.freeze({
      version: "3.28",
      date: "2026.08.30",
      items: Object.freeze([
        "종목탐구 로컬·배포 4개 검색 경로 통일",
        "코스피·코스닥 홀짝 분할과 실패 종목 단계별 재확인",
        "검색 정지와 현재까지의 결과 즉시 확인",
        "불완전 검색 결과의 공유 캐시 오염 방지",
      ]),
    }),
    Object.freeze({
      version: "3.27",
      date: "2026.08.30",
      items: Object.freeze([
        "종목탐구 신호 기간 OFF·1일·15일·30일 순환 필터",
        "1일 필터의 최근 거래일·직전 거래일 신호 포함",
        "기간과 최소 신호 횟수 조합 검색",
        "최근 30거래일 신호 후보 캐시 재활용",
      ]),
    }),
    Object.freeze({
      version: "3.26",
      date: "2026.08.29",
      items: Object.freeze([
        "진단 기능 지연 로딩과 메인 번들 경량화",
        "부팅 후 캐시 정리 작업의 분산 실행",
        "로컬·배포 장중 신호 상태 판정 통합",
        "차트 포인터 좌표 계산과 장마감 타이머 공통화",
        "종목탐구 Worker 종료 수명주기 개선",
      ]),
    }),
    Object.freeze({
      version: "3.25",
      date: "2026.08.29",
      items: Object.freeze([
        "장중 신호의 실시간 상태 표시와 종가 확정 처리",
        "장 마감 후 탈락 신호 자동 제거",
        "메인차트·종목탐구 신호 기준 통합",
        "종가 확인의 단일 실행과 반복 조회 축소",
      ]),
    }),
    Object.freeze({
      version: "3.24",
      date: "2026.08.29",
      items: Object.freeze([
        "차트 갱신 판단과 AI·EPS 렌더링 경로 통합",
        "종목별 파생 계산 캐시의 단일 수명주기 적용",
        "부팅 후 보조 데이터 작업의 중첩 실행 제거",
        "Worker·데이터 모듈 통합과 전역 연결 축소",
        "다중 차트 렌더링 성능 회귀 기준 강화",
      ]),
    }),
    Object.freeze({
      version: "3.23",
      date: "2026.08.29",
      items: Object.freeze([
        "부팅 후 중복 작업 통합과 조작 우선순위 개선",
        "숨긴 다중 차트의 불필요한 전체 이력 계산 제거",
        "차트 모델 Worker·캐시·대체 계산 경로 공통화",
        "갱신 상태 렌더링 조율 공통화",
        "종목 추가·전환 시 가격 우선 단계 렌더링",
      ]),
    }),
    Object.freeze({
      version: "3.22",
      date: "2026.08.29",
      items: Object.freeze([
        "로컬·배포 기업분석 값 일치 계약 추가",
        "EPS 부분 응답과 불완전 캐시 자동 차단",
        "Worker 규격 확인과 배포 전 값 대조 검사",
        "재무·뉴스 갱신시각 분리와 진단 보강",
        "재무 병합 중복 구현 공통화",
      ]),
    }),
    Object.freeze({
      version: "3.21",
      date: "2026.08.27",
      items: Object.freeze([
        "AI·리포트 조율 런타임 분리와 메인 코드 경량화",
        "차트·초기 데이터 Worker의 표준 모듈 전환",
        "차트 핵심 전역 연결 7개 제거",
        "뷰포트 버퍼 재사용과 오프라인 자산 검증 보강",
      ]),
    }),
    Object.freeze({
      version: "3.20",
      date: "2026.08.27",
      items: Object.freeze([
        "AI 리포트 수집기의 2차 지연 로딩과 번들 경량화",
        "뷰포트·이벤트 계산 캐시 재사용 확대",
        "기능 생명주기와 Worker 생성 규칙 공통화",
        "리포트 파서·캐시의 전역 연결 제거",
      ]),
    }),
    Object.freeze({
      version: "3.19",
      date: "2026.08.27",
      items: Object.freeze([
        "보조차트 렌더러 지연 로딩과 초기 번들 경량화",
        "차트·보조지표 갱신 경계 추가 정리",
        "모듈 연결과 렌더링 성능 검증 보강",
      ]),
    }),
    Object.freeze({
      version: "3.18",
      date: "2026.08.27",
      items: Object.freeze([
        "차트 축 좌표와 핸들 갱신의 프레임 단위 재사용",
        "데이터 스냅샷 저장의 사용자 입력 우선 처리",
        "성능 진단 지연 로딩과 메인 번들 경량화",
        "차트 계산 캐시 효율 측정 보강",
        "핵심 런타임 데이터 계약 안전장치 추가",
      ]),
    }),
    Object.freeze({
      version: "3.17",
      date: "2026.08.27",
      items: Object.freeze([
        "차트 핸들·마커 갱신을 단일 화면 프레임으로 통합",
        "백그라운드 캐시 작업의 사용자 입력 우선 처리",
        "최근 차트 계산·원본 지문 캐시 재사용 확대",
        "선택 기능·차트 핵심 연결 모듈 간소화",
        "부팅 완료·장시간 멈춤 성능 기록과 수명주기 개선",
      ]),
    }),
    Object.freeze({
      version: "3.16",
      date: "2026.08.26",
      items: Object.freeze([
        "공통 요청·차트 갱신 중복 처리 축소",
        "AI·신호 모듈 연결 안정화",
        "앱·Worker 책임 경계 추가 정리",
        "번들 용량·타입 계약 검증 강화",
      ]),
    }),
    Object.freeze({
      version: "3.15",
      date: "2026.08.26",
      items: Object.freeze([
        "차트 계산 모듈의 전역 연결 제거",
        "앱·Worker 책임 경계 추가 정리",
        "다중 차트 조작과 부팅 후 반응성 개선",
        "검증·배포 작업 병렬화 기반 보강",
      ]),
    }),
    Object.freeze({
      version: "3.14",
      date: "2026.08.26",
      items: Object.freeze([
        "선택 기능 지연 로딩과 번들 여유 확보",
        "데이터·차트·오버레이 책임 경계 정리",
        "보조차트·Worker 생명주기 안정화",
        "전역 연결과 중복 처리 추가 축소",
      ]),
    }),
    Object.freeze({
      version: "3.13",
      date: "2026.08.26",
      items: Object.freeze([
        "부팅 완료 후 백그라운드 작업 안정화",
        "캐시 유지보수와 숨은 종목 준비 경량화",
        "후속 렌더링·저장 작업 공통 조율",
        "전역 연결과 앱 초기화 책임 축소",
      ]),
    }),
    Object.freeze({
      version: "3.12",
      date: "2026.08.25",
      items: Object.freeze([
        "AI 예측선 수직 이동 동기화",
        "차트 오버레이 변환 경로 통합",
        "차트선 선택 강조 두께 조정",
        "중복 차트 판정 규칙 정리",
      ]),
    }),
    Object.freeze({
      version: "3.11",
      date: "2026.08.25",
      items: Object.freeze([
        "차트 핵심 모듈 표준 연결 전환",
        "마커·선·팝업 선택 처리 공통화",
        "렌더링·핸들 갱신 중복 축소",
        "앱 종료 정리와 전역 연결 검사 강화",
      ]),
    }),
    Object.freeze({
      version: "3.10",
      date: "2026.08.25",
      items: Object.freeze([
        "EPS 정보창 날짜·행 정렬 통일",
        "앱 부팅·버튼 연결 구조 분리",
        "스타일 소스 역할별 분할",
        "표준 모듈 연결 단계적 적용",
      ]),
    }),
    Object.freeze({
      version: "3.09",
      date: "2026.08.25",
      items: Object.freeze([
        "메인 번들 지연 로딩 범위 확대",
        "앱 초기화·기능 연결 책임 정리",
        "진행바·상태 UI 공통 규칙 통합",
        "기타 구조·성능 최적화",
      ]),
    }),
    Object.freeze({
      version: "3.08",
      date: "2026.08.25",
      items: Object.freeze([
        "차트 오버레이·정보창 처리 공통화",
        "다중 차트 조작과 캐시 성능 개선",
        "가격 무결성·배포 검사 보강",
        "앱 구조와 모듈 책임 정리",
      ]),
    }),
    Object.freeze({
      version: "3.07",
      date: "2026.08.25",
      items: Object.freeze([
        "EPS 액면분할·병합 기준 자동 보정",
        "EPS 정보창 날짜·해당 시점 주가 통합",
        "신호·EPS 버튼 순서 개선",
      ]),
    }),
    Object.freeze({
      version: "3.06",
      date: "2026.08.24",
      items: Object.freeze([
        "공시·내부거래·신호 마커 처리 통합",
        "차트선·핸들 이동 구조 공통화",
        "AI·EPS 미래 구간 복원 안정화",
        "보조차트 이동·토글 렌더링 경량화",
        "차트 렌더 예약과 내부 검증 개선",
      ]),
    }),
    Object.freeze({
      version: "3.05",
      date: "2026.08.24",
      items: Object.freeze([
        "EPS 포인터·분기 원 선택 판정 경량화",
        "EPS 스케일 조작과 공시·신호 재계산 분리",
        "EPS 정보창 좌표·핸들·렌더 캐시 개선",
        "과거 EPS 자료 일괄 병합·저장",
        "EPS 성능 회귀검사 추가",
      ]),
    }),
    Object.freeze({
      version: "3.04",
      date: "2026.08.24",
      items: Object.freeze([
        "분기 EPS 원값 우선 점선 차트 추가",
        "과거 분기·미래 연간 EPS 성장폭 연결",
        "실제 EPS 증가폭 보존 및 전용 스케일 핸들",
      ]),
    }),
    Object.freeze({
      version: "3.03",
      date: "2026.08.24",
      items: Object.freeze([
        "거래가 드문 우선주 가격 이력 판정 개선",
        "장기 무거래 구간과 액면분할 검증 분리",
        "신규 종목 추가 안정화",
      ]),
    }),
    Object.freeze({
      version: "3.02",
      date: "2026.08.22",
      items: Object.freeze([
        "입력 우선 백그라운드 작업 통합",
        "메인차트·종목탐구 신호 계산 캐시 공유",
        "오래되거나 손상된 캐시 자동 정리",
        "가격·캐시 책임과 앱 구조 정돈",
        "중복 차트 렌더링 및 보조차트 갱신 절감",
        "부팅 동행율 표시와 MACD 선 두께 보정",
      ]),
    }),
    Object.freeze({
      version: "3.01",
      date: "2026.08.22",
      items: Object.freeze([
        "가격·액면분할 캐시 무결성 강화",
        "숨은 종목의 부팅 후 계산 분리",
        "종목탐구 증분 캐시 재사용 검증",
        "공시·신호 마커 선택 판정 공통화",
        "증권사별 최신 리포트 중복 제거",
        "동행율 선택 기능 지연 로딩",
        "AI 예측 승격 검증 및 안정 모델 유지",
        "초기 로딩 및 기타 구조 최적화",
      ]),
    }),
    Object.freeze({
      version: "3.00",
      date: "2026.08.22",
      items: Object.freeze([
        "AI 분석 PDF 세션 재사용",
        "리포트 중복 다운로드 제거",
        "Cloudflare 리포트 자동 캐시",
      ]),
    }),
    Object.freeze({
      version: "2.99",
      date: "2026.08.21",
      items: Object.freeze([
        "종목탐구·메인 차트 신호 가격 기준 통합",
        "액면분할·기업행동 최신 경계 자동 복구",
        "기업행동 복구 실패 시 기존 차트 안전 유지",
      ]),
    }),
    Object.freeze({
      version: "2.98",
      date: "2026.08.21",
      items: Object.freeze([
        "매수·매도 신호 계산식 독립 검증 및 선택",
        "전체 종목 무작위 10종목 반복 신호 감사 추가",
        "미사용 기간·손실 꼬리·신호 빈도 회귀 방지 강화",
        "신규 매수식 채택 및 기존 매도식 유지",
        "장기 종목 성질과 최근 시장 국면 진단 분리",
      ]),
    }),
    Object.freeze({
      version: "2.97",
      date: "2026.08.21",
      items: Object.freeze([
      "시점별 종목 행동형 프로필 신호 계산 추가",
      "시장 국면별 반전·눌림·소진 신호 계열 분리",
      "이례적 과매수·과매도 경고와 방향 예측 성과 분리",
      "고변동 하락주 단기 반등과 박스권 종목 추세 신호 분리",
      "종목 전체 가격 이력 복구와 휴장일 0거래량 가격 자동 제거",
      "미래 데이터 차단형 신호 검증 강화",
      ]),
    }),
    Object.freeze({
      version: "2.96",
      date: "2026.08.21",
      items: Object.freeze([
        "외부 데이터 제공자 오류·재시도 정책 통합",
        "로컬·배포 데이터 복구 규칙 공용화",
        "AI·신호·종목탐구 선택 기능 로딩 단축",
        "캐시 갱신 및 중복 계산 경로 정리",
        "AI·신호 품질 검증 표본 확대",
        "신호 시장국면·근거 등급과 VKOSPI 정책 개선",
        "10개 차트·아이폰 조작 회귀검사 강화",
        "앱 상태 조정 구조 추가 모듈화",
      ]),
    }),
    Object.freeze({
      version: "2.95",
      date: "2026.08.20",
      items: Object.freeze([
        "지표별 최신일자·누락·부분 실패 진단 강화",
        "VIX 확정 종가 이후 당일 최신 시세 보완",
        "로컬·배포 런타임 데이터 규칙 통합",
        "앱 실시간 갱신 처리 추가 모듈화",
        "차트 마커 중복 갱신 제거",
        "AI 보정·워크포워드 검증 기록 강화",
        "종목탐구 1000종목 증분 캐시 보존",
        "종목별 AI 입력 캐시 재사용 개선",
      ]),
    }),
    Object.freeze({
      version: "2.94",
      date: "2026.08.20",
      items: Object.freeze([
        "VIX 독립 갱신과 최신값 복구 강화",
        "AI 참고 리포트 링크 전용 경량화",
        "검증되지 않은 리포트 예측 가중치 제거",
        "AI 예측선 핸들 제거",
      ]),
    }),
    Object.freeze({
      version: "2.93",
      date: "2026.08.16",
      items: Object.freeze([
        "신용·예탁금 최신값 보조 원천 및 지연 감지 추가",
        "로컬 원본값과 배포 캐시의 안전한 자동 동기화",
      ]),
    }),
    Object.freeze({
      version: "2.92",
      date: "2026.08.16",
      items: Object.freeze([
        "차트 우측 여백 0~30일 설정 추가",
        "확대·이동·AI 예측 범위에 동일한 여백 정책 적용",
      ]),
    }),
    Object.freeze({
      version: "2.91",
      date: "2026.08.16",
      items: Object.freeze([
        "AI·메인 차트 범위와 표시 대상 사전 계산 통합",
        "차트 모델 지문 재사용으로 동일 렌더링 비교 비용 절감",
        "DART 공시·내부거래 실시간 요청 공통화",
        "중복 요청 상태 제거 및 기타 런타임 최적화",
      ]),
    }),
    Object.freeze({
      version: "2.90",
      date: "2026.08.16",
      items: Object.freeze([
        "차트 AI 입력 배열 재사용으로 반복 렌더링 비용 절감",
        "종목탐구 대용량 결과를 IndexedDB 비동기 캐시로 전환",
        "DART 기업코드·공시 시드 요청 공통화",
        "선택 기능 중복 로딩 제거",
        "로컬 검증 결과 재사용으로 배포 빌드 단축",
      ]),
    }),
    Object.freeze({
      version: "2.89",
      date: "2026.08.16",
      items: Object.freeze([
        "AI 검증 통과 모델만 실사용하는 승격 기준 강화",
        "시장·국면·변동성·종목 성격별 표본과 회귀 방지 확대",
        "증권사 리포트 판단과 이후 실제 수익률 자동 비교",
        "타이밍 신호 유형별 과적합 차단 기준 추가",
        "신용·예탁금·심리·변동성 데이터 공백과 충돌 검증 강화",
        "중복 AI·리포트 요청과 동일 차트 렌더링 제거",
        "아이폰 차트 포인터와 좌표 계산 최적화",
        "배포 의존성 재사용과 기타 구조 최적화",
      ]),
    }),
    Object.freeze({
      version: "2.88",
      date: "2026.08.15",
      items: Object.freeze([
        "한경·네이버 최신 리포트 교차 확인",
        "증권사별 최신 1개·최대 3개 분석",
        "PDF 분석 백그라운드 처리와 증분 캐시",
        "AI 참고 리포트 클릭 및 최신 링크 보장",
        "리포트 시점 누수 차단과 가중치 검증",
        "AI 리포트 유무별 편향 검증 강화",
        "신호 과거 구간 과적합 검사 추가",
        "배포 검증 중복 축소 및 기타 최적화",
      ]),
    }),
    Object.freeze({
      version: "2.87",
      date: "2026.08.15",
      items: Object.freeze([
        "증권사 리포트 정량 분석 추가",
        "향후 EPS·ROE 및 목표가 변화 반영",
        "목표가 하향·연속 하향 위험 가중",
        "리포트 로컬 캐시와 중복 분석 방지",
        "PDF 표 검증 및 AI 입력 안전장치 강화",
        "기타 최적화",
      ]),
    }),
    Object.freeze({
      version: "2.86",
      date: "2026.08.15",
      items: Object.freeze([
        "AI Qlib 거래량·거래대금·유동성 학습 보강",
        "코스피·코스닥 순위 기반 학습 표본 확대",
        "종목 성격별 보조 모델과 독립 확인군 도입",
        "동일 종목·동일 날짜 Qlib 비교 검증 추가",
        "검증 미통과 Qlib 결과의 앱 반영 차단",
        "기타 최적화",
      ]),
    }),
    Object.freeze({
      version: "2.85",
      items: Object.freeze([
        "AI Qlib 한국 주식 퀀트 검증 파이프라인 도입",
        "한국시장 거래규칙·종목분리 검증 적용",
        "Qlib 검증 전 런타임 혼합 차단",
        "기타 최적화",
      ]),
    }),
    Object.freeze({
      version: "2.84",
      items: Object.freeze([
      "AI 200종목 성질별 층화표본 도입",
        "AI 개발·검증·감사 종목 완전 분리",
        "AI 지수 장기 검증 표본 확대",
        "AI 과거 DART 재무 근거 확장",
        "AI 횡보·저변동 63일 재검증",
        "기타 최적화",
      ]),
    }),
    Object.freeze({
      version: "2.83",
      items: Object.freeze([
        "AI 과거시점 기업 근거 검증 확대",
        "AI 공시 위험 기간별 보정",
        "AI 63일 예측 회귀 검증 강화",
        "AI 검증 데이터 누출 방지 강화",
        "기타 최적화",
      ]),
    }),
    Object.freeze({
      version: "2.82",
      items: Object.freeze([
        "app.js 런타임 데이터 처리 구조 정리",
        "차트 이동 자동 스케일 계산 최적화",
        "성능 병목 이력 누적 분석 강화",
        "AI 종목 성질·시장 국면 보정",
        "AI 보정 워크포워드 안전장치",
        "설정·AI 선택 기능 지연 로딩",
        "메인 번들 여유 공간 확대",
      ]),
    }),
    Object.freeze({
      version: "2.81",
      items: Object.freeze([
        "WebKit 검증 중복 제거 및 병렬화",
        "실사용 성능 병목 순위 기록",
        "런타임 지표 정규화 경로 통합",
        "AI 박스권 및 시장 국면 보정 강화",
        "대용량 캐시 측정 및 보관 안정화",
        "공급자 연속 실패 및 복구 검증 강화",
        "app.js 데이터 처리 구조 정리",
        "기타 최적화",
      ]),
    }),
    Object.freeze({
      version: "2.80",
      items: Object.freeze([
        "데이터 이상값 격리·마지막 정상값 복구 강화",
        "재무요약·실적 서프라이즈 결합 개선",
        "차트 갱신 트랜잭션 중복 축소",
        "AI 과거시점 검증·신호 자동보정 강화",
        "캐시 메타데이터·무효화 규칙 통합",
        "앱·Worker 모듈 구조 정리",
        "실사용 성능 내부 로그 개선",
        "AI 최고확률 시나리오 단일 강조",
      ]),
    }),
    Object.freeze({
      version: "2.79",
      items: Object.freeze([
        "AI 동일 표본 워크포워드·배포 안전장치 강화",
        "과거 시점 기업 근거 충족 기준 강화",
        "매수·매도 방향별 신호 품질 검증",
        "데이터 최신일·공백·이상치 상태 기록 통합",
        "앱 데이터 최신성 처리 추가 모듈화",
        "Worker 공통 HTTP·캐시 처리 모듈화",
        "구형 관리자 인증 이관 경로 정리",
      ]),
    }),
    Object.freeze({
      version: "2.78",
      items: Object.freeze([
        "지수 6종 색상 고정 및 종목 색상 자동 배정",
        "AI 계산 불가 사유 중앙 안내",
        "차트 마커 좌표 계산 캐시 개선",
        "매수·매도 신호 중복 계산 축소",
        "AI 전용 계산 모듈 지연 로딩",
        "데이터 파싱 Worker 재사용",
        "종목 제거 UI 개선",
      ]),
    }),
    Object.freeze({
      version: "2.77",
      items: Object.freeze([
        "로컬·Cloudflare 공시 처리 규칙 통합",
        "데이터 범위·공백·이상치 품질 기록 통합",
        "가격 수정 시 파생 캐시 선택 갱신",
        "AI 기준 모델·후보 모델 승격 검증 강화",
        "매수·매도 신호 홀드아웃 품질 검사 강화",
        "차트 엔진 설정 모듈화",
        "변경 범위별 검사 속도 개선",
        "관리자 인증 Cloudflare 서명 세션 전환",
        "로컬·클라우드 API 응답 규칙 통합",
      ]),
    }),
    Object.freeze({
      version: "2.76",
      items: Object.freeze([
        "메인차트 도구 접기 및 동행율 재배치",
        "공개 배포 데이터 이력·해시 검증 강화",
        "iPhone 홈 화면 캐시 교체 검사 추가",
        "뉴스심리 데이터 갱신 경로 통합",
        "진단 기록 민감정보 보호 강화",
        "GitHub 빌드 실행환경 Node 24 전환",
        "차트 도구 연결 구조 최적화",
      ]),
    }),
    Object.freeze({
      version: "2.75",
      items: Object.freeze([
        "뉴스심리 2005년 이후 전체 이력 복구",
        "iPhone 홈 화면 과거 뉴스심리 표시 개선",
        "뉴스심리 배포 데이터 누락 방지 검증 추가",
      ]),
    }),
    Object.freeze({
      version: "2.74",
      items: Object.freeze([
        "종목 성격·시장 국면 진단 기반 추가",
        "AI 종목군·국면별 워크포워드 검증 강화",
        "검증된 단기 예측 경로 회귀 방지",
        "iPhone 홈 화면 공포탐욕·VIX 복구",
        "공포탐욕·VIX 기본 이력 내장",
        "서비스워커 즉시 업데이트 개선",
      ]),
    }),
    Object.freeze({
      version: "2.73",
      items: Object.freeze([
        "AI 국면별 워크포워드·비교 검증 강화",
        "과거 시점 데이터 누출 검사 추가",
        "예측 근거·편향·기준모델 진단 개선",
        "국내 영업일·데이터 제공처 교차검증 강화",
        "AI 시나리오 불확실성 표시 개선",
        "Worker·앱 모듈 구조 최적화",
      ]),
    }),
    Object.freeze({
      version: "2.72",
      items: Object.freeze([
        "이례적 급등락 이후 AI 시나리오 다양화",
        "실제 전일대비 등락률 신호 설명 추가",
        "종목탐구 대규모 검색·캐시 재사용 개선",
        "급등락 국면별 AI 사후검증·로그 보존",
        "기타 최적화",
      ]),
    }),
    Object.freeze({
      version: "2.71",
      items: Object.freeze([
        "VKOSPI·VIX 변동성 보조지표 통합",
        "공식 VIX 일별 데이터 자동 갱신",
        "AI·매매신호 변동성 분석 강화",
        "AI 예측 실적 기반 편향 보정",
        "런타임 데이터 품질·캐시 무효화 개선",
        "캐시 종류별 용량 상세보기",
        "설정 정보 패널 전환 개선",
        "차트·Worker 구조 최적화",
      ]),
    }),
    Object.freeze({
      version: "2.70",
      items: Object.freeze([
        "종목 교체·공시 마커 렌더링 최적화",
        "AI 예측 국면별 품질 진단 강화",
        "매수·매도 신호 신뢰도 집계 개선",
        "차트 성능 계측·회귀 검증 강화",
      ]),
    }),
    Object.freeze({
      version: "2.69",
      items: Object.freeze([
        "렌더링 경로 진단 강화",
        "AI 예측 신뢰도 자동 보정",
        "매수·매도 신호 사후 검증 집계",
        "성능 진단 자동 기록 개선",
        "VKOSPI 로컬 검증 안정화",
      ]),
    }),
    Object.freeze({
      version: "2.68",
      items: Object.freeze([
        "지표 날짜·갱신 정책 통합",
        "캐시 수명·무효화 개선",
        "차트 구성·렌더링 계측 개선",
        "AI 예측·매매신호 사후 검증 강화",
        "변경 범위 검사 최적화",
      ]),
    }),
    Object.freeze({
      version: "2.67",
      items: Object.freeze([
        "최신일 자동 추적 개선",
      ]),
    }),
    Object.freeze({
      version: "2.66",
      items: Object.freeze([
        "데이터 공백·이상치 자동 점검 개선",
        "차트 렌더링·드래그 성능 개선",
        "종목별 증분 캐시 계산 개선",
        "AI 워크포워드 검증·보정 강화",
        "로컬 검사·빌드 절차 최적화",
      ]),
    }),
    Object.freeze({
      version: "2.65",
      items: Object.freeze([
        "VIX 보조지표 추가",
        "AI 예측 알고리즘 개선",
        "부팅 속도 개선",
        "VKOSPI 신호 연관성 검증",
        "설정 및 업데이트 내역 개선",
        "보조지표 토글 레이아웃 개선",
        "기타 최적화",
      ]),
    }),
    Object.freeze({
      version: "2.58",
      items: Object.freeze([
        "종목탐구 통합 캐시 및 당일 신호 개선",
        "가격·지수 최신 데이터 갱신 안정화",
        "차트 확대·이동 및 아이폰 조작 개선",
        "기타 최적화",
      ]),
    }),
    Object.freeze({
      version: "2.34",
      items: Object.freeze([
        "종목탐구 증분 계산 도입",
        "차트 상태 및 AI 탐색 안정화",
        "기타 최적화",
      ]),
    }),
    Object.freeze({
      version: "2.24",
      items: Object.freeze([
        "AI 예측 경로 다양화",
        "뉴스 위험 판단 및 신호 로직 강화",
        "모바일 차트 사용성 개선",
      ]),
    }),
    Object.freeze({
      version: "2.01",
      items: Object.freeze([
        "가격·지표 런타임 갱신 전환",
        "공시·내부거래 표시 안정화",
        "차트 렌더링 최적화",
      ]),
    }),
  ]);

  function createReleaseNotesNavigator(releases = RELEASES) {
    const source = Array.isArray(releases) && releases.length ? releases : RELEASES;
    let index = 0;
    const current = () => source[index];
    const state = () => ({
      release: current(),
      index,
      total: source.length,
      hasNewer: index > 0,
      hasOlder: index < source.length - 1,
    });
    return Object.freeze({
      current: state,
      newer() {
        index = Math.max(0, index - 1);
        return state();
      },
      older() {
        index = Math.min(source.length - 1, index + 1);
        return state();
      },
      reset() {
        index = 0;
        return state();
      },
    });
  }

export { RELEASES, SOURCE_BYTES, createReleaseNotesNavigator };
