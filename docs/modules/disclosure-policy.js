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

  function createDisclosureDataService(options = {}) {
    const classifyType = options.classifyType || classifyDisclosureType;
    const shouldDisplay = options.shouldDisplay || shouldDisplayDisclosure;
    const labelName = options.labelName || ((value) => String(value || ""));
    const refreshCacheKey = String(options.refreshCacheKey || "");
    const refreshCacheTtlMs = Math.max(1, Number(options.refreshCacheTtlMs) || 86400000);
    const getStorage = options.getStorage || (() => null);
    const now = options.now || (() => Date.now());

    function sanitizeRows(records) {
      if (!Array.isArray(records)) return [];
      const output = [];
      const seen = new Set();
      records.forEach((record) => {
        if (!record || typeof record !== "object") return;
        const ticker = String(record.ticker || "").trim().toUpperCase();
        const code = String(record.code || ticker.split(".")[0] || "").trim();
        const date = String(record.date || "").slice(0, 10);
        const title = String(record.title || record.report_nm || "").trim();
        if (!/^[0-9]{6}\.(KS|KQ)$/.test(ticker) || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !title) return;
        const classifiedType = classifyType(title);
        const rawType = String(record.type || "").trim();
        const type = !rawType || rawType === "공시" ? classifiedType : rawType;
        if (!shouldDisplay(title, type)) return;
        const url = String(record.url || "").trim();
        const key = `${ticker}|${date}|${title}|${url}`;
        if (seen.has(key)) return;
        seen.add(key);
        output.push({
          ticker,
          code,
          name: String(record.name || record.corp_name || labelName(ticker)).trim() || labelName(ticker),
          date,
          type,
          title,
          summary: String(record.summary || "").trim(),
          url,
          source: String(record.source || "DART").trim(),
          receiptNo: String(record.receiptNo || record.rcept_no || "").trim(),
        });
      });
      return output.sort((left, right) => (
        left.date.localeCompare(right.date) || left.ticker.localeCompare(right.ticker)
      ));
    }

    function mergeRows(existingRows, incomingRows) {
      const rows = new Map();
      sanitizeRows(existingRows).forEach((row) => {
        rows.set(`${row.ticker}|${row.date}|${row.title}`, row);
      });
      sanitizeRows(incomingRows).forEach((row) => {
        rows.set(`${row.ticker}|${row.date}|${row.title}`, row);
      });
      return [...rows.values()].sort((left, right) => (
        left.date.localeCompare(right.date) || left.ticker.localeCompare(right.ticker)
      ));
    }

    function readRefreshCache() {
      try {
        const raw = getStorage()?.getItem(refreshCacheKey);
        const parsed = raw ? JSON.parse(raw) : {};
        return parsed && typeof parsed === "object" ? parsed : {};
      } catch (_) {
        return {};
      }
    }

    function getRefreshCacheEntry(ticker) {
      const target = String(ticker || "").trim().toUpperCase();
      if (!target) return null;
      const entry = readRefreshCache()[target];
      const savedAt = Number(entry?.savedAt || 0);
      if (!entry || !Number.isFinite(savedAt) || now() - savedAt > refreshCacheTtlMs) return null;
      return entry;
    }

    function rememberRefresh(ticker, info) {
      const target = String(ticker || "").trim().toUpperCase();
      if (!target) return;
      const cache = readRefreshCache();
      cache[target] = {
        savedAt: now(),
        fetched: Number(info?.fetched || 0),
        added: Number(info?.added || 0),
        latestDate: String(info?.latestDate || ""),
      };
      try { getStorage()?.setItem(refreshCacheKey, JSON.stringify(cache)); } catch (_) {}
    }

    return Object.freeze({
      sanitizeRows,
      mergeRows,
      getRefreshCacheEntry,
      rememberRefresh,
      hasFreshRefresh: (ticker) => Boolean(getRefreshCacheEntry(ticker)),
    });
  }

  globalThis.ThinkStockDisclosurePolicy = Object.freeze({
    classifyDisclosureType,
    isImportantDisclosureTitle,
    isLowImpactDisclosureTitle,
    shouldDisplayDisclosure,
    createDisclosureDataService,
  });
})();
