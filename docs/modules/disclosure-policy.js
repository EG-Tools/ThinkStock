(() => {
  function classifyDisclosureType(title) {
    const text = String(title || "");
    if (/반기보고서|분기보고서|사업보고서|영업\(잠정\)실적|잠정실적|매출액.?또는.?손익구조|감사보고서제출/.test(text)) return "실적";
    if (/배당|현금ㆍ현물배당|현금.?현물배당/.test(text)) return "배당";
    if (/단일판매|공급계약|수주/.test(text)) return "수주";
    if (/유상증자|무상증자|감자|증권신고서\(지분증권\)/.test(text)) return "증자/감자";
    if (/전환사채|신주인수권|신주인수권부사채|교환사채|사채권/.test(text)) return "자금조달";
    if (/자기주식(취득|처분)결정|주식소각/.test(text)) return "자사주";
    if (/합병|분할|영업양수|영업양도|타법인주식|출자증권|신규시설투자|시설투자/.test(text)) return "구조/투자";
    if (/최대주주변경|대표이사.*변경|영업정지|거래정지|상장폐지|관리종목|소송|횡령|배임|회생|파산|부도|공개매수|장래사업|경영계획/.test(text)) return "경영변동";
    return "공시";
  }

  function isImportantDisclosureTitle(title, type = "") {
    const text = String(title || "");
    const normalizedType = String(type || "");
    if (/^(실적|배당|수주|증자\/감자|자금조달|자사주|구조\/투자|경영변동)$/.test(normalizedType)) return true;
    return /반기보고서|분기보고서|사업보고서|영업\(잠정\)실적|잠정실적|매출액.?또는.?손익구조|감사보고서제출|배당|현금ㆍ현물배당|단일판매|공급계약|수주|유상증자|무상증자|감자|증권신고서\(지분증권\)|전환사채|신주인수권|신주인수권부사채|교환사채|사채권|자기주식(취득|처분)결정|주식소각|합병|분할|영업양수|영업양도|타법인주식|출자증권|신규시설투자|시설투자|최대주주변경|대표이사.*변경|영업정지|거래정지|상장폐지|관리종목|소송|횡령|배임|회생|파산|부도|공개매수|장래사업|경영계획/.test(text);
  }

  function isLowImpactDisclosureTitle(title) {
    const text = String(title || "");
    return /임원ㆍ주요주주특정증권등소유상황보고서|주식등의대량보유상황보고서|최대주주등소유주식변동신고서|기업설명회|IR\)|대규모기업집단현황공시|기업지배구조보고서|지속가능경영보고서|동일인등출자계열회사|특수관계인|지급수단별|주주총회소집공고|주주총회소집결의|주주총회집중일|정기주주총회결과|의결권대리행사|주주명부폐쇄|기준일설정|사외이사의선임|해임또는중도퇴임|자기주식취득결과보고서|자기주식처분결과보고서/.test(text);
  }

  function shouldDisplayDisclosure(title, type = "") {
    if (isImportantDisclosureTitle(title, type)) return true;
    if (isLowImpactDisclosureTitle(title)) return false;
    return false;
  }

  globalThis.ThinkStockDisclosurePolicy = Object.freeze({
    classifyDisclosureType,
    isImportantDisclosureTitle,
    isLowImpactDisclosureTitle,
    shouldDisplayDisclosure,
  });
})();
