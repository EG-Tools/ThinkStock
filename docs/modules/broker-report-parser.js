(function initThinkStockBrokerReportParser(globalScope) {
  "use strict";

  const valueContract = globalScope.ThinkStockRuntimeFoundation?.values;
  const reportPolicy = globalScope.ThinkStockBrokerReportPolicy;
  if (!valueContract || !reportPolicy) throw new Error("broker report contracts failed to load");

  const SCHEMA_VERSION = 2;
  const PARSER_REVISION = "quant-v3";
  const DAY_MS = 24 * 60 * 60 * 1000;
  const METRIC_DEFINITIONS = Object.freeze([
    Object.freeze({ key: "operatingProfit", pattern: /^(?:영업이익|영업손익|Operating\s+Profit|OP)(?=\s|\(|$)/i, kind: "money" }),
    Object.freeze({ key: "revenue", pattern: /^(?:매출액|영업수익|Revenue|Sales)(?=\s|\(|$)/i, kind: "money" }),
    Object.freeze({
      key: "eps",
      pattern: /^EPS(?=\s|\(|$)/i,
      embeddedPattern: /(?:^|\s)EPS(?=\s|\(|$)/i,
      kind: "perShare",
    }),
    Object.freeze({
      key: "roe",
      pattern: /^ROE(?=\s|\(|$)/i,
      embeddedPattern: /(?:^|\s)ROE(?=\s|\(|$)/i,
      kind: "percent",
    }),
  ]);

  const finite = valueContract.finiteOrNull;

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, Number(value) || 0));
  }

  function median(values) {
    const sorted = (Array.isArray(values) ? values : [])
      .map(finite)
      .filter((value) => value !== null)
      .sort((left, right) => left - right);
    if (!sorted.length) return null;
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  }

  function average(values) {
    const usable = (Array.isArray(values) ? values : []).map(finite).filter((value) => value !== null);
    return usable.length ? usable.reduce((sum, value) => sum + value, 0) / usable.length : null;
  }

  function normalizedLine(value) {
    return String(value || "")
      .replace(/[\u00a0\u2007\u202f]/g, " ")
      .replace(/[−–—]/g, "-")
      .replace(/\s+/g, " ")
      .trim();
  }

  function normalizedPages(input) {
    const pages = Array.isArray(input) ? input : [];
    if (pages.length && typeof pages[0] === "string") {
      return [Object.freeze({ page: 1, lines: pages.map(normalizedLine).filter(Boolean) })];
    }
    return pages.map((page, index) => Object.freeze({
      page: Math.max(1, Math.round(Number(page?.page) || index + 1)),
      lines: (Array.isArray(page?.lines) ? page.lines : [])
        .map(normalizedLine)
        .filter(Boolean),
    }));
  }

  function parseHeaderYears(line, reportYear) {
    const values = [];
    const pattern = /(^|[^\d])(20\d{2}|\d{2})\s*([AEFP])?(?=$|[^A-Z\d])/gi;
    for (const match of normalizedLine(line).matchAll(pattern)) {
      let year = Number(match[2]);
      if (year < 100) year += 2000;
      if (year < reportYear - 4 || year > reportYear + 5) continue;
      const estimateCode = String(match[3] || "").toUpperCase();
      if (values.some((entry) => entry.year === year)) continue;
      values.push(Object.freeze({ year, estimate: ["E", "F", "P"].includes(estimateCode), code: estimateCode }));
    }
    if (values.length < 3 || !values.some((entry) => entry.year >= reportYear + 1)) return [];
    if (!values.some((entry) => entry.estimate || entry.year > reportYear)) return [];
    return values;
  }

  function numberTokens(value) {
    const matches = normalizedLine(value).match(/\(?-?\d[\d,]*(?:\.\d+)?\)?|(?:^|\s)-(?:\s|$)/g) || [];
    return matches.map((token) => {
      const text = token.trim();
      if (text === "-") return null;
      const negativeParentheses = text.startsWith("(") && text.endsWith(")");
      const number = Number(text.replace(/[(),]/g, ""));
      if (!Number.isFinite(number)) return null;
      return negativeParentheses ? -number : number;
    });
  }

  function leadingNumberTokens(value) {
    const text = normalizedLine(value).replace(/^\([^)]{0,24}\)\s*/, "");
    const values = [];
    for (const token of text.split(/\s+/)) {
      if (!/^\(?-?\d[\d,]*(?:\.\d+)?\)?$/.test(token) && token !== "-") break;
      values.push(numberTokens(token)[0] ?? null);
    }
    return values;
  }

  function unitForRow(line, nearbyText, kind) {
    if (kind === "perShare") return "KRW";
    if (kind === "percent") return "%";
    if (kind === "multiple") return "x";
    const text = `${line} ${nearbyText}`;
    if (/십억원/.test(text)) return "KRW_BILLION";
    if (/억원/.test(text)) return "KRW_100_MILLION";
    if (/백만원/.test(text)) return "KRW_MILLION";
    if (/천원/.test(text)) return "KRW_THOUSAND";
    return "UNKNOWN";
  }

  function validMetricValue(metric, value) {
    if (value === null) return true;
    const absolute = Math.abs(value);
    if (metric.kind === "percent") return absolute <= 500;
    if (metric.kind === "multiple") return value >= -100 && value <= 2000;
    if (metric.kind === "perShare") return absolute <= 100_000_000;
    return absolute <= 1_000_000_000_000;
  }

  function growthRate(currentValue, nextValue) {
    const current = finite(currentValue);
    const next = finite(nextValue);
    if (current === null || next === null || Math.abs(current) < 1e-9) return null;
    if (current < 0 || next < 0) return null;
    return clamp((next / current) - 1, -3, 3);
  }

  function revisionDirection(value, threshold = 0.015) {
    const change = finite(value);
    if (change === null || Math.abs(change) < threshold) return 0;
    return Math.sign(change);
  }

  function parseAnnualTable(page, headerIndex, headerYears, reportYear, options = {}) {
    const currentYear = reportYear;
    const nextYear = reportYear + 1;
    const currentIndex = headerYears.findIndex((entry) => entry.year === currentYear);
    const nextIndex = headerYears.findIndex((entry) => entry.year === nextYear);
    if (currentIndex < 0 || nextIndex < 0) return null;
    const lines = page.lines;
    const rows = {};
    const headerEndIndex = Math.max(headerIndex, Number(options.headerEndIndex) || headerIndex);
    const nearbyText = lines.slice(Math.max(0, headerIndex - 2), headerEndIndex + 3).join(" ");
    const maximumIndex = Math.min(lines.length, headerEndIndex + 29);
    for (let index = headerEndIndex + 1; index < maximumIndex; index += 1) {
      const line = lines[index];
      if (index > headerIndex + 2 && parseHeaderYears(line, reportYear).length >= 3) break;
      let definition = null;
      let labelMatch = null;
      for (const candidate of METRIC_DEFINITIONS) {
        const match = line.match(candidate.pattern)
          || (candidate.embeddedPattern ? line.match(candidate.embeddedPattern) : null);
        if (!match) continue;
        definition = candidate;
        labelMatch = match;
        break;
      }
      if (!definition || rows[definition.key]) continue;
      const remainder = line.slice(Number(labelMatch?.index || 0) + String(labelMatch?.[0] || "").length);
      let values = numberTokens(remainder);
      if (values.length > headerYears.length) {
        const leadingValues = leadingNumberTokens(remainder);
        if (leadingValues.length >= headerYears.length) values = leadingValues.slice(0, headerYears.length);
      }
      if (values.length < headerYears.length && index + 1 < maximumIndex) {
        const continuation = lines[index + 1];
        const startsAnotherMetric = METRIC_DEFINITIONS.some((candidate) => (
          candidate.pattern.test(continuation)
          || (candidate.embeddedPattern && candidate.embeddedPattern.test(continuation))
        ));
        const continuedValues = startsAnotherMetric ? [] : numberTokens(continuation);
        if (values.length + continuedValues.length === headerYears.length) {
          values = [...values, ...continuedValues];
        }
      }
      if (values.length !== headerYears.length) continue;
      if (values.some((value) => !validMetricValue(definition, value))) continue;
      const current = values[currentIndex];
      const next = values[nextIndex];
      if (current === null && next === null) continue;
      rows[definition.key] = Object.freeze({
        current,
        next,
        growth: definition.kind === "percent"
          ? (current === null || next === null ? null : next - current)
          : growthRate(current, next),
        unit: unitForRow(line, nearbyText, definition.kind),
        row: index + 1,
      });
    }
    const coreKeys = ["revenue", "operatingProfit", "eps", "roe"];
    const coreCount = coreKeys.filter((key) => (
      rows[key]
      && rows[key].current !== null
      && rows[key].next !== null
    )).length;
    if (coreCount < 2) return null;
    const primaryCount = ["eps", "roe"].filter((key) => (
      rows[key]
      && rows[key].current !== null
      && rows[key].next !== null
    )).length;
    return Object.freeze({
      page: page.page,
      headerRow: headerIndex + 1,
      currentYear,
      nextYear,
      years: headerYears,
      rows: Object.freeze(rows),
      coreCount,
      primaryCount,
      metricCount: Object.keys(rows).length,
      layoutAdapter: String(options.layoutAdapter || "single-line-header"),
    });
  }

  function annualTableHeaders(page, reportYear) {
    const candidates = [];
    page.lines.forEach((line, index) => {
      const direct = parseHeaderYears(line, reportYear);
      if (direct.length) {
        candidates.push({ index, endIndex: index, years: direct, adapter: "single-line-header" });
        return;
      }
      if (index + 1 >= page.lines.length) return;
      const combined = parseHeaderYears(`${line} ${page.lines[index + 1]}`, reportYear);
      if (combined.length) {
        candidates.push({ index, endIndex: index + 1, years: combined, adapter: "split-header" });
      }
    });
    return candidates;
  }

  function candidateScore(candidate) {
    const rows = candidate?.rows || {};
    return (candidate?.coreCount || 0) * 10
      + (candidate?.metricCount || 0)
      + ((candidate?.primaryCount || 0) * 8)
      + (rows.eps ? 3 : 0)
      + (rows.operatingProfit ? 2 : 0)
      + (rows.roe ? 1 : 0);
  }

  function normalizeRecommendation(value) {
    const text = String(value || "").replace(/\s+/g, "").toUpperCase();
    if (!text) return null;
    if (/SELL|매도|REDUCE|UNDERPERFORM/.test(text)) return -1;
    if (/HOLD|중립|NEUTRAL|MARKETPERFORM/.test(text)) return 0;
    if (/BUY|매수|OUTPERFORM|강력매수/.test(text)) return 1;
    return null;
  }

  function reportYearFromMetadata(metadata) {
    const year = Number(String(metadata?.publishedDate || "").slice(0, 4));
    return year >= 2000 && year <= 2100 ? year : new Date().getUTCFullYear();
  }

  function targetRevisionFromPages(pages, metadata) {
    const lines = pages.slice(0, 3).flatMap((page) => page.lines);
    for (const line of lines) {
      const start = line.indexOf("목표주가");
      if (start < 0) continue;
      const revisionWindow = line.slice(start, start + 120);
      if (/하향/.test(revisionWindow)) return -1;
      if (/상향/.test(revisionWindow)) return 1;
      if (/(?:유지|변경\s*없음)/.test(revisionWindow)) return 0;
    }
    const change = finite(metadata?.targetPriceChange);
    if (change === null || Math.abs(change) < 0.015) return change === null ? null : 0;
    return Math.sign(change);
  }

  function parseReport(pagesInput, metadata = {}) {
    const pages = normalizedPages(pagesInput);
    const reportYear = reportYearFromMetadata(metadata);
    const candidates = [];
    let headerCandidateCount = 0;
    pages.forEach((page) => {
      annualTableHeaders(page, reportYear).forEach(({ index, endIndex, years, adapter }) => {
        headerCandidateCount += 1;
        const candidate = parseAnnualTable(page, index, years, reportYear, {
          headerEndIndex: endIndex,
          layoutAdapter: adapter,
        });
        if (candidate) candidates.push(candidate);
      });
    });
    candidates.sort((left, right) => candidateScore(right) - candidateScore(left));
    const best = candidates[0] || null;
    const targetPriceChange = finite(metadata?.targetPriceChange);
    const targetRevision = targetRevisionFromPages(pages, metadata);
    const targetRevisionStreak = Math.max(0, Math.min(12, Math.round(Number(metadata?.targetRevisionStreak) || 0)));
    const directionalTargetRevision = revisionDirection(targetPriceChange) !== 0
      || Math.abs(Number(targetRevision)) === 1;
    if (!best || best.primaryCount < 1) {
      if (directionalTargetRevision) {
        return Object.freeze({
          schema: SCHEMA_VERSION,
          parserRevision: PARSER_REVISION,
          usable: true,
          analysisMode: "target-revision-only",
          reportId: String(metadata?.id || ""),
          publishedDate: String(metadata?.publishedDate || "").slice(0, 10),
          availableDate: reportPolicy.reportAvailableDate(metadata),
          availabilityPrecision: String(metadata?.availabilityPrecision || "date-only"),
          broker: String(metadata?.broker || ""),
          analyst: String(metadata?.analyst || ""),
          title: String(metadata?.title || ""),
          sourceUrl: String(metadata?.sourceUrl || ""),
          targetPrice: finite(metadata?.targetPrice),
          previousTargetPrice: finite(metadata?.previousTargetPrice),
          targetPriceChange,
          targetRevision,
          targetRevisionStreak,
          recommendation: normalizeRecommendation(metadata?.recommendation),
          currentFiscalYear: best?.currentYear || null,
          nextFiscalYear: best?.nextYear || null,
          metrics: Object.freeze({}),
          evidence: Object.freeze({
            page: best?.page || null,
            headerRow: best?.headerRow || null,
            metricCount: 0,
            coreMetricCount: 0,
            primaryMetricCount: 0,
            pagesScanned: pages.length,
            headerCandidateCount,
            layoutAdapter: best?.layoutAdapter || "target-only",
          }),
          confidence: clamp(0.48
            + (targetPriceChange !== null ? 0.12 : 0)
            + (Math.abs(Number(targetRevision)) === 1 ? 0.08 : 0)
            + (targetRevisionStreak >= 2 ? 0.05 : 0), 0.48, 0.73),
        });
      }
      return Object.freeze({
        schema: SCHEMA_VERSION,
        parserRevision: PARSER_REVISION,
        usable: false,
        reason: best ? "primary-forward-metrics-not-found" : "verified-forward-table-not-found",
        reportId: String(metadata?.id || ""),
        publishedDate: String(metadata?.publishedDate || "").slice(0, 10),
        availableDate: reportPolicy.reportAvailableDate(metadata),
        availabilityPrecision: String(metadata?.availabilityPrecision || "date-only"),
        broker: String(metadata?.broker || ""),
        analyst: String(metadata?.analyst || ""),
        title: String(metadata?.title || ""),
        sourceUrl: String(metadata?.sourceUrl || ""),
        source: String(metadata?.source || ""),
        targetPrice: finite(metadata?.targetPrice),
        previousTargetPrice: finite(metadata?.previousTargetPrice),
        targetPriceChange,
        targetRevision,
        targetRevisionStreak,
        recommendation: normalizeRecommendation(metadata?.recommendation),
        evidence: Object.freeze({
          pagesScanned: pages.length,
          headerCandidateCount,
          tableCandidateCount: candidates.length,
        }),
      });
    }
    const rowConfidence = clamp(best.primaryCount / 2, 0, 1);
    const breadthConfidence = clamp(best.metricCount / 4, 0, 1);
    const confidence = clamp(0.45 + (rowConfidence * 0.35) + (breadthConfidence * 0.2), 0, 0.98);
    return Object.freeze({
      schema: SCHEMA_VERSION,
      parserRevision: PARSER_REVISION,
      usable: true,
      analysisMode: "forward-primary",
      reportId: String(metadata?.id || ""),
      publishedDate: String(metadata?.publishedDate || "").slice(0, 10),
      availableDate: reportPolicy.reportAvailableDate(metadata),
      availabilityPrecision: String(metadata?.availabilityPrecision || "date-only"),
      broker: String(metadata?.broker || ""),
      analyst: String(metadata?.analyst || ""),
      title: String(metadata?.title || ""),
      sourceUrl: String(metadata?.sourceUrl || ""),
      targetPrice: finite(metadata?.targetPrice),
      previousTargetPrice: finite(metadata?.previousTargetPrice),
      targetPriceChange,
      targetRevision,
      targetRevisionStreak,
      recommendation: normalizeRecommendation(metadata?.recommendation),
      currentFiscalYear: best.currentYear,
      nextFiscalYear: best.nextYear,
      metrics: best.rows,
      evidence: Object.freeze({
        page: best.page,
        headerRow: best.headerRow,
        metricCount: best.metricCount,
        coreMetricCount: best.coreCount,
        primaryMetricCount: best.primaryCount,
        pagesScanned: pages.length,
        headerCandidateCount,
        tableCandidateCount: candidates.length,
        layoutAdapter: best.layoutAdapter,
      }),
      confidence,
    });
  }

  function ageDays(dateText, asOfDate) {
    const start = Date.parse(`${String(dateText || "").slice(0, 10)}T00:00:00Z`);
    const end = Date.parse(`${String(asOfDate || "").slice(0, 10)}T00:00:00Z`);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return Infinity;
    return Math.max(0, Math.round((end - start) / DAY_MS));
  }

  function metricSummary(reports, key) {
    const growth = reports.map((report) => report.metrics?.[key]?.growth).filter((value) => finite(value) !== null);
    const current = reports.map((report) => report.metrics?.[key]?.current).filter((value) => finite(value) !== null);
    const next = reports.map((report) => report.metrics?.[key]?.next).filter((value) => finite(value) !== null);
    if (!growth.length && !current.length && !next.length) return null;
    return Object.freeze({
      current: median(current),
      next: median(next),
      change: median(growth),
      observations: Math.max(growth.length, current.length, next.length),
    });
  }

  function representativeReport(reports, direction) {
    const ranked = reports.map((report) => {
      const targetChange = finite(report.targetPriceChange);
      const score = reportPolicy.scoreBrokerReportEvidence({
        epsChange: report.metrics?.eps?.growth,
        roeChange: report.metrics?.roe?.growth,
        targetRevisionChange: targetChange,
        hasTargetRevision: targetChange !== null || finite(report.targetRevision) !== null,
        targetCutBreadth: targetChange !== null && targetChange < -0.015 ? 1 : 0,
        targetCutStreak: report.targetRevisionStreak,
        parserConfidence: report.confidence,
        coverageConfidence: 1,
        primaryCoverage: [report.metrics?.eps, report.metrics?.roe].filter(Boolean).length / 2,
        targetDeviation: 0,
      });
      return { report, signal: score.signal, confidence: score.confidence };
    }).filter(({ report }) => report.sourceUrl && report.title);
    ranked.sort((left, right) => direction === "upside"
      ? right.signal - left.signal || right.report.publishedDate.localeCompare(left.report.publishedDate)
      : left.signal - right.signal || right.report.publishedDate.localeCompare(left.report.publishedDate));
    const selected = ranked[0];
    if (!selected || (direction === "upside" ? selected.signal <= 0.03 : selected.signal >= -0.03)) return null;
    return Object.freeze({
      reportId: String(selected.report.reportId || selected.report.id || ""),
      publishedDate: selected.report.publishedDate,
      availableDate: reportPolicy.reportAvailableDate(selected.report),
      broker: selected.report.broker,
      title: selected.report.title,
      sourceUrl: selected.report.sourceUrl,
      signal: selected.signal,
      confidence: selected.confidence,
      quantitative: true,
    });
  }

  function referenceReport(reports) {
    const selected = [...(Array.isArray(reports) ? reports : [])]
      .filter((report) => report?.sourceUrl && report?.title)
      .sort((left, right) => String(right.publishedDate).localeCompare(String(left.publishedDate)))[0];
    if (!selected) return null;
    return Object.freeze({
      reportId: String(selected.reportId || selected.id || ""),
      publishedDate: selected.publishedDate,
      availableDate: reportPolicy.reportAvailableDate(selected),
      broker: selected.broker,
      title: selected.title,
      sourceUrl: selected.sourceUrl,
      signal: null,
      confidence: 0,
      quantitative: selected.usable === true,
    });
  }

  function summarizeReports(reportRecords, asOfDate, options = {}) {
    const maximumAgeDays = Math.max(1, Math.min(365, Number(options.maximumAgeDays) || 180));
    const historicalMode = options.historicalMode === true;
    const activeIds = new Set((Array.isArray(options.activeReportIds) ? options.activeReportIds : []).map(String));
    const eligibleReports = (Array.isArray(reportRecords) ? reportRecords : [])
      .filter((report) => !activeIds.size || activeIds.has(String(report.reportId || report.id || "")))
      .filter((report) => reportPolicy.reportIsAvailableAt(report, asOfDate, { historicalMode }))
      .filter((report) => ageDays(report.publishedDate, asOfDate) <= maximumAgeDays)
      .sort((left, right) => String(right.publishedDate).localeCompare(String(left.publishedDate)));
    if (!eligibleReports.length) return null;
    const reports = eligibleReports.filter((report) => report?.usable === true);
    const latestByBroker = [];
    const brokers = new Set();
    reports.forEach((report) => {
      const broker = String(report.broker || "").replace(/\s+/g, "").toLowerCase()
        || `unknown:${report.reportId}`;
      if (brokers.has(broker) || latestByBroker.length >= 5) return;
      brokers.add(broker);
      latestByBroker.push(report);
    });
    const metrics = Object.freeze(Object.fromEntries(METRIC_DEFINITIONS
      .map(({ key }) => [key, metricSummary(latestByBroker, key)])
      .filter(([, summary]) => summary)));
    const targetPrices = latestByBroker.map((report) => report.targetPrice).filter((value) => finite(value) > 0);
    const targetPrice = median(targetPrices);
    const targetDeviation = targetPrice && targetPrices.length > 1
      ? median(targetPrices.map((value) => Math.abs(value - targetPrice))) / targetPrice
      : null;
    const recommendations = latestByBroker
      .map((report) => finite(report.recommendation))
      .filter((value) => value !== null);
    const targetRevisionChanges = latestByBroker.map((report) => {
      const change = finite(report.targetPriceChange);
      if (change !== null) return change;
      const direction = finite(report.targetRevision);
      return direction === null ? null : direction * 0.2;
    }).filter((value) => value !== null);
    const targetRevisionChange = median(targetRevisionChanges);
    const targetCutCount = targetRevisionChanges.filter((value) => value < -0.015).length;
    const targetRaiseCount = targetRevisionChanges.filter((value) => value > 0.015).length;
    const targetRevisionBreadth = targetRevisionChanges.length;
    const targetCutBreadth = targetRevisionBreadth ? targetCutCount / targetRevisionBreadth : 0;
    const targetRaiseBreadth = targetRevisionBreadth ? targetRaiseCount / targetRevisionBreadth : 0;
    const targetCutStreak = latestByBroker.reduce((maximum, report) => {
      if (revisionDirection(report.targetPriceChange) >= 0) return maximum;
      return Math.max(maximum, Math.max(1, Number(report.targetRevisionStreak) || 1));
    }, 0);
    const parserConfidence = average(latestByBroker.map((report) => report.confidence)) || 0;
    const coverageConfidence = clamp(latestByBroker.length / 5, 0.2, 1);
    const primaryCoverage = [metrics.eps, metrics.roe].filter(Boolean).length / 2;
    const scored = reportPolicy.scoreBrokerReportEvidence({
      epsChange: metrics.eps?.change,
      roeChange: metrics.roe?.change,
      targetRevisionChange,
      hasTargetRevision: targetRevisionChanges.length > 0,
      targetCutBreadth,
      targetCutStreak,
      parserConfidence,
      coverageConfidence,
      primaryCoverage,
      targetDeviation,
    });
    const representativeReports = Object.freeze({
      upside: representativeReport(latestByBroker, "upside"),
      downside: representativeReport(latestByBroker, "downside"),
      reference: referenceReport(eligibleReports),
    });
    const hasQuantitativeEvidence = latestByBroker.length > 0;
    return Object.freeze({
      schema: SCHEMA_VERSION,
      parserRevision: PARSER_REVISION,
      asOfDate: String(asOfDate || "").slice(0, 10),
      latestDate: eligibleReports[0]?.publishedDate || "",
      latestAvailableDate: eligibleReports
        .map((report) => reportPolicy.reportAvailableDate(report, { historicalMode }))
        .filter(Boolean)
        .sort()
        .at(-1) || "",
      reportCount: latestByBroker.length,
      referenceReportCount: eligibleReports.length,
      brokerCount: brokers.size,
      usedReportIds: Object.freeze(latestByBroker.map((report) => String(report.reportId))),
      currentFiscalYear: latestByBroker[0]?.currentFiscalYear || null,
      nextFiscalYear: latestByBroker[0]?.nextFiscalYear || null,
      targetPrice,
      targetPriceAverage: average(targetPrices),
      targetPriceDispersion: targetDeviation,
      targetRevisionChange,
      targetRevisionSignal: scored.targetRevisionSignal,
      targetCutCount,
      targetRaiseCount,
      targetCutBreadth,
      targetRaiseBreadth,
      targetCutStreak,
      recommendation: recommendations.length ? average(recommendations) : null,
      metrics,
      primaryCoverage,
      primaryConflict: hasQuantitativeEvidence && scored.primaryConflict,
      downsideAgreement: hasQuantitativeEvidence && scored.downsideAgreement,
      upsideAgreement: hasQuantitativeEvidence && scored.upsideAgreement,
      signal: hasQuantitativeEvidence ? scored.signal : 0,
      confidence: hasQuantitativeEvidence ? scored.confidence : 0,
      adjustment: hasQuantitativeEvidence ? scored.adjustment : 0,
      policyVersion: scored.policyVersion,
      representativeReports,
    });
  }

  function reportSummaryFingerprint(summary) {
    if (!summary) return "";
    return JSON.stringify({
      asOfDate: summary.asOfDate,
      latestDate: summary.latestDate,
      latestAvailableDate: summary.latestAvailableDate,
      usedReportIds: summary.usedReportIds,
      targetPrice: summary.targetPrice,
      targetRevisionChange: summary.targetRevisionChange,
      targetCutBreadth: summary.targetCutBreadth,
      targetCutStreak: summary.targetCutStreak,
      recommendation: summary.recommendation,
      metrics: summary.metrics,
      primaryCoverage: summary.primaryCoverage,
      primaryConflict: summary.primaryConflict,
      signal: summary.signal,
      confidence: summary.confidence,
      policyVersion: summary.policyVersion,
      representativeReports: summary.representativeReports,
    });
  }

  globalScope.ThinkStockBrokerReportParser = Object.freeze({
    PARSER_REVISION,
    SCHEMA_VERSION,
    normalizeRecommendation,
    parseHeaderYears,
    parseReport,
    reportSummaryFingerprint,
    summarizeReports,
  });
}(typeof self !== "undefined" ? self : globalThis));
