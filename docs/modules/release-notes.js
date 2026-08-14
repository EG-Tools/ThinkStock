(function initThinkStockReleaseNotes(globalScope) {
  "use strict";

  const RELEASES = Object.freeze([
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

  globalScope.ThinkStockReleaseNotes = Object.freeze({
    RELEASES,
    createReleaseNotesNavigator,
  });
}(typeof self !== "undefined" ? self : globalThis));
