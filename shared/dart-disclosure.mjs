export const DART_DISCLOSURE_TYPES = Object.freeze(["A", "B", "C", "E", "I"]);
export const DART_DISCLOSURE_MAX_PAGES = 100;

export const IMPORTANT_DISCLOSURE_PATTERN = /반기보고서|분기보고서|사업보고서|영업\(잠정\)실적|잠정실적|매출액.?또는.?손익구조|감사보고서제출|배당|현금ㆍ현물배당|단일판매|공급계약|수주|유상증자|무상증자|감자|증권신고서\(지분증권\)|전환사채|신주인수권|신주인수권부사채|교환사채|사채권|자기주식(취득|처분)결정|주식소각|합병|분할|영업양수|영업양도|타법인주식|출자증권|신규시설투자|시설투자|최대주주변경|대표이사.*변경|영업정지|거래정지|상장폐지|관리종목|소송|횡령|배임|회생|파산|부도|공개매수|장래사업|경영계획/;

export function recordFromDartItem(ticker, item) {
  const target = String(ticker || "").trim().toUpperCase();
  const rawDate = String(item?.rcept_dt || "").trim();
  const title = String(item?.report_nm || "").trim();
  if (!target || !/^\d{8}$/.test(rawDate) || !title || !IMPORTANT_DISCLOSURE_PATTERN.test(title)) {
    return null;
  }
  const receiptNo = String(item?.rcept_no || "").trim();
  return {
    ticker: target,
    code: target.slice(0, 6),
    name: String(item?.corp_name || "").trim(),
    date: `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}`,
    title,
    summary: "",
    source: "OpenDART",
    receiptNo,
    url: receiptNo
      ? `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${encodeURIComponent(receiptNo)}`
      : "",
  };
}

export function mergeDartDisclosureRecords(existing, incoming) {
  const records = new Map();
  [...(Array.isArray(existing) ? existing : []), ...(Array.isArray(incoming) ? incoming : [])]
    .forEach((record) => {
      if (!record?.ticker || !record?.date || !record?.title) return;
      const key = String(record.receiptNo || record.url || `${record.date}|${record.title}`);
      records.set(key, record);
    });
  return [...records.values()].sort((left, right) => (
    String(left.date).localeCompare(String(right.date))
      || String(left.title).localeCompare(String(right.title))
  ));
}

export function selectDartDisclosureEvidenceAsOf(records, ticker, cutoff, options = {}) {
  const target = String(ticker || "").trim().toUpperCase();
  const asOf = String(cutoff || "").slice(0, 10);
  const maximumRows = Math.max(1, Number(options.maximumRows) || 120);
  if (!target || !/^\d{4}-\d{2}-\d{2}$/.test(asOf)) return [];
  return mergeDartDisclosureRecords([], records)
    .filter((record) => (
      String(record?.ticker || "").trim().toUpperCase() === target
      && /^\d{4}-\d{2}-\d{2}$/.test(String(record?.date || "").slice(0, 10))
      && String(record.date).slice(0, 10) <= asOf
    ))
    .slice(-maximumRows);
}
