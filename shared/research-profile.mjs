const CATEGORY_OVERRIDES = Object.freeze({
  "003670": "2차전지",
  "006400": "2차전지",
  "011790": "2차전지",
  "020150": "2차전지",
  "066970": "2차전지",
  "078600": "2차전지",
  "086520": "2차전지",
  "121600": "2차전지",
  "137400": "2차전지",
  "247540": "2차전지",
  "278280": "2차전지",
  "336370": "2차전지",
  "348370": "2차전지",
  "361610": "2차전지",
  "373220": "2차전지",
  "450080": "2차전지",
});

function decodeHtml(value) {
  return String(value || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/\s+/g, " ")
    .trim();
}

export function parseNaverResearchProfile(html, ticker = "") {
  const code = String(ticker || "").trim().toUpperCase().match(/^(\d{6})(?:\.(?:KS|KQ))?$/)?.[1] || "";
  const match = String(html || "").match(
    /<a[^>]+href=["'][^"']*sise_group_detail\.naver\?[^"']*type=upjong[^"']*["'][^>]*>([\s\S]*?)<\/a>/i,
  );
  const industry = decodeHtml(match?.[1]).slice(0, 32);
  const override = CATEGORY_OVERRIDES[code] || "";
  const category = override || industry;
  return {
    category,
    industry,
    categoryType: override ? "테마" : (industry ? "업종" : ""),
  };
}

export const RESEARCH_CATEGORY_OVERRIDES = CATEGORY_OVERRIDES;
