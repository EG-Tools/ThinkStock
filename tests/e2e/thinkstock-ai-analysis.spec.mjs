import {
  expect,
  test,
  recentDates,
  historyDates,
  DESKTOP_PERF_BUDGET,
  setChartRangeMonths,
  waitForBoundingBox,
  waitForChartRenderIdle,
  visibleTracePixelSpan,
  columnar,
  stubExternalRefreshes,
  installDataRoutes,
} from "./helpers/thinkstock-fixture.mjs";
import {
  COMPANY_ANALYSIS_CONTRACT_VERSION,
  FINANCIAL_SUMMARY_VERSION,
} from "../../shared/company-analysis-contract.mjs";

test("AI toggle draws and removes a six-month virtual forecast", async ({ page, isMobile }) => {
  await stubExternalRefreshes(page);
  await page.goto("/?e2e=1", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#chart .main-svg").first()).toBeVisible();
  await page.locator("#chartRange6Months").click();
  await expect.poll(() => page.locator("#chart").evaluate((element) => {
    const [start, end] = element._fullLayout.xaxis.range.map(Date.parse);
    return (end - start) / 86400000;
  })).toBeLessThan(190);
  const entryRange = await page.locator("#chart").evaluate((element) => (
    element._fullLayout.xaxis.range.map(Date.parse)
  ));

  await page.locator("#aiForecastToggle").click();
  await expect(page.locator("#aiForecastToggle")).toHaveClass(/is-active/);
  await expect(page.locator("#aiForecastProgress")).toBeVisible();
  await expect.poll(() => page.locator("#chart").evaluate((element) => (
    (element.data || []).filter((trace) => trace?.meta?.isAiForecastTrace).length
  )), { timeout: 30000 }).toBeGreaterThan(0);
  await expect.poll(() => page.locator("#chart").evaluate((element, before) => {
    const forecastEnd = Math.max(...(element.data || [])
      .filter((trace) => trace?.meta?.isAiForecastScenarioTrace)
      .flatMap((trace) => (trace.x || []).map(Date.parse).filter(Number.isFinite)));
    const [start, end] = element._fullLayout.xaxis.range.map(Date.parse);
    return {
      historyStartPreserved: Math.abs(start - before[0]) <= 86400000,
      futureVisible: end >= forecastEnd,
    };
  }, entryRange)).toEqual({ historyStartPreserved: true, futureVisible: true });
  await expect.poll(() => page.locator("#chart").evaluate((element) => {
    const [rangeStart, rangeEnd] = (element?._fullLayout?.xaxis?.range || []).map(Date.parse);
    const [rangeLow, rangeHigh] = (element?._fullLayout?.yaxis?.range || []).map(Number);
    const tolerance = Math.max(0.05, Math.abs(rangeHigh - rangeLow) * 0.002);
    return (element.data || [])
      .filter((trace) => trace?.meta?.isAiForecastScenarioTrace)
      .flatMap((trace) => (trace.x || []).flatMap((date, index) => {
        const time = Date.parse(date);
        const value = Number(trace.y?.[index]);
        if (!Number.isFinite(time) || !Number.isFinite(value)
          || time < rangeStart || time > rangeEnd) return [];
        return value < rangeLow - tolerance || value > rangeHigh + tolerance ? [value] : [];
      })).length;
  }), { message: "AI forecast remained outside the auto-fitted chart range" }).toBe(0);
  const scenarioSummary = await page.locator("#chart").evaluate((element) => {
    const traces = (element.data || []).filter((trace) => trace?.meta?.isAiForecastScenarioTrace);
    return {
      count: traces.length,
      roles: [...new Set(traces.map((trace) => trace.meta.aiTraceRole))].sort(),
      endpoints: traces.map((trace) => String(trace.text?.at(-1) || "")),
      hoverTemplates: traces.map((trace) => String(trace.hovertemplate || "")),
      hasMacroIndex: traces.some((trace) => trace.meta.forecastMode === "macro-index"),
      styles: traces.map((trace) => ({
        series: trace.meta.seriesKey,
        probability: Number(trace.meta.scenarioProbability),
        weight: Number(trace.meta.scenarioWeight),
        calibratedProbability: trace.meta.calibratedProbability,
        primary: trace.meta.isPrimaryAiScenario === true,
        rawPrimary: trace.meta.isRawPrimaryAiScenario === true,
        emphasized: trace.meta.isEmphasizedAiScenario === true,
        decisive: trace.meta.isDecisiveAiScenario === true,
        scenarioLead: Number(trace.meta.aiScenarioLead),
        expectedDirection: String(trace.meta.aiExpectedDirection || ""),
        role: String(trace.meta.aiTraceRole || ""),
        width: Number(trace.line?.width),
        color: String(trace.line?.color || ""),
        reason: String(trace.meta.scenarioReason || ""),
        patternKey: String(trace.meta.scenarioPatternKey || ""),
        pathSource: String(trace.meta.scenarioPathSource || ""),
      })),
    };
  });
  expect(scenarioSummary.count).toBeGreaterThanOrEqual(3);
  expect(scenarioSummary.count % 3).toBe(0);
  expect(scenarioSummary.roles).toEqual(["downside", "sideways", "upside"]);
  expect(scenarioSummary.endpoints.every((text) => /^.+ \d+%$/.test(text))).toBe(true);
  expect(scenarioSummary.endpoints.every((text) => text.includes("가중치"))).toBe(true);
  expect(scenarioSummary.hoverTemplates
    .filter(Boolean)
    .every((text) => text.includes("실제 확률 아님"))).toBe(true);
  expect(scenarioSummary.hoverTemplates.every((text) => (
    !text.includes("%{x")
    && !text.includes("검증 예상범위")
    && !text.includes("시장 관계 학습")
    && !text.includes("컨센서스 반영")
    && !text.includes("실적 추세 반영")
  ))).toBe(true);
  expect(scenarioSummary.hasMacroIndex).toBe(true);
  const scenarioStyleGroups = Map.groupBy(scenarioSummary.styles, (style) => style.series);
  scenarioStyleGroups.forEach((styles) => {
    expect(new Set(styles.map((style) => style.reason)).size).toBe(3);
    expect(new Set(styles.map((style) => style.patternKey)).size).toBe(3);
    expect(styles.every((style) => [
      "conditional-analogs",
      "regime-fallback",
      "short-term-shock-regime",
    ].includes(
      style.pathSource,
    ))).toBe(true);
    const highestProbability = Math.max(...styles.map((style) => style.probability));
    expect(styles.every((style) => style.weight === style.probability)).toBe(true);
    expect(styles.every((style) => style.calibratedProbability === false)).toBe(true);
    const rawPrimaryStyles = styles.filter((style) => style.rawPrimary);
    expect(rawPrimaryStyles.length).toBe(1);
    expect(rawPrimaryStyles.every((style) => style.probability === highestProbability)).toBe(true);
    const [rawPrimaryStyle] = rawPrimaryStyles;
    expect(rawPrimaryStyle.emphasized).toBe(true);
    expect(rawPrimaryStyle.width).toBe(1);
    expect(rawPrimaryStyle.color).toBe("#ffffff");
    const secondaryStyles = styles.filter((style) => !style.rawPrimary);
    expect(secondaryStyles.every((style) => !style.emphasized)).toBe(true);
    expect(new Set(secondaryStyles.map((style) => style.width)).size).toBe(1);
    expect(new Set(secondaryStyles.map((style) => style.color)).size).toBe(1);
    expect(secondaryStyles.every((style) => style.width === rawPrimaryStyle.width)).toBe(true);
    expect(secondaryStyles.every((style) => style.color === "#777777")).toBe(true);
    const primaryStyles = styles.filter((style) => style.primary);
    expect(primaryStyles.length).toBe(1);
    const [primaryStyle] = primaryStyles;
    if (primaryStyle.decisive) {
      expect(primaryStyle.probability).toBe(highestProbability);
    } else {
      expect([primaryStyle.expectedDirection, "sideways"]).toContain(primaryStyle.role);
    }
  });
  await page.waitForTimeout(250);
  const reportMarkerPoint = await page.locator("#chart").evaluate(async (element) => {
    const scenario = (element.data || []).find((trace) => (
      trace?.meta?.isAiForecastScenarioTrace && trace?.meta?.isEmphasizedAiScenario
    ));
    const markerIndex = Math.round(((scenario?.x?.length || 1) - 1) * 0.5);
    const reports = [
      {
        publishedDate: "2026-08-22",
        broker: "현대차증권",
        title: "가장 최신인 첫 번째 참고 리포트 제목은 화면 폭보다 아주 길게 작성되었습니다",
        sourceUrl: "https://consensus.hankyung.com/analysis/downpdf?report_idx=31",
      },
      {
        publishedDate: "2026-08-20",
        broker: "미래에셋증권",
        title: "두 번째 참고 리포트",
        sourceUrl: "https://consensus.hankyung.com/analysis/downpdf?report_idx=30",
      },
      {
        publishedDate: "2026-08-19",
        broker: "키움증권",
        title: "세 번째 참고 리포트",
        sourceUrl: "https://consensus.hankyung.com/analysis/downpdf?report_idx=29",
      },
    ];
    await globalThis.Plotly.addTraces(element, {
      x: [scenario.x[markerIndex]],
      y: [scenario.y[markerIndex]],
      type: "scatter",
      mode: "markers+text",
      marker: { symbol: "circle", size: 20 },
      text: ["R"],
      meta: {
        seriesKey: scenario.meta.seriesKey,
        isAiReportMarkerTrace: true,
        reports,
      },
    });
    const marker = (element.data || []).find((trace) => trace?.meta?.isAiReportMarkerTrace);
    const xaxis = element?._fullLayout?.xaxis;
    const yaxis = element?._fullLayout?.yaxis;
    const rect = element.getBoundingClientRect();
    const x = rect.left + Number(xaxis?._offset || 0) + Number(xaxis?.d2p?.(marker?.x?.[0]));
    const y = rect.top + Number(yaxis?._offset || 0) + Number(yaxis?.d2p?.(marker?.y?.[0]));
    return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
  });
  expect(reportMarkerPoint).not.toBeNull();
  if (isMobile) await page.touchscreen.tap(reportMarkerPoint.x, reportMarkerPoint.y);
  else await page.mouse.click(reportMarkerPoint.x, reportMarkerPoint.y);
  await expect(page.locator("#chart .disclosure-popover")).toBeVisible();
  await expect(page.locator("#chart .disclosure-title-link")).toHaveCount(3);
  await expect(page.locator("#chart .disclosure-title-link").first()).toHaveAttribute(
    "href",
    "https://consensus.hankyung.com/analysis/downpdf?report_idx=31",
  );
  await expect(page.locator("#chart .disclosure-popover")).toContainText("26.08.22");
  await expect(page.locator("#chart .disclosure-popover")).toContainText("현대차증권");
  await expect(page.locator("#chart .disclosure-popover")).toContainText("26.08.20");
  await expect(page.locator("#chart .disclosure-title-link").first()).toContainText("...");
  await page.locator("#chart .disclosure-popover").getByRole("button", { name: "공시 닫기" }).click();
  await page.locator("#chart .disclosure-popover").evaluate((element) => element.remove());
  await page.mouse.move(reportMarkerPoint.x, reportMarkerPoint.y);
  await expect(page.locator("#chart")).toHaveClass(/is-ai-report-hovering/);
  await expect.poll(() => page.locator("#chart").evaluate((element) => getComputedStyle(element).cursor))
    .toBe("pointer");
  await page.mouse.click(reportMarkerPoint.x, reportMarkerPoint.y);
  await expect(page.locator("#chart .disclosure-popover")).toBeVisible();
  await page.locator("#chart .disclosure-popover").getByRole("button", { name: "공시 닫기" }).click();
  const horizonPoints = await page.locator("#chart").evaluate((element) => (
    (element.data || []).find((trace) => trace?.meta?.isAiForecastTrace)?.x?.length || 0
  ));
  expect(horizonPoints).toBe(127);
  const linkedDrag = await page.locator("#chart").evaluate((element) => {
      const scenario = (element.data || []).find((trace) => trace?.meta?.isAiForecastScenarioTrace);
      const seriesKey = scenario?.meta?.seriesKey;
      const priceTraceIndex = (element.data || []).findIndex((trace) => (
        trace?.meta?.overlayKind === "price" && trace?.meta?.seriesKey === seriesKey
      ));
      const priceTrace = element.data?.[priceTraceIndex];
      const xAxis = element?._fullLayout?.xaxis;
      const yAxis = element?._fullLayout?.yaxis;
      const rect = element.getBoundingClientRect();
      const range = (xAxis?.range || []).map(Date.parse);
      const midpoint = (range[0] + range[1]) / 2;
      const priorityPoints = (element.data || []).flatMap((trace) => {
        const isPriorityMarker = trace?.meta?.isCrisisSignalTrace
          || trace?.meta?.isMarketTimingBuyTrace
          || trace?.meta?.isMarketTimingSellTrace
          || trace?.meta?.isInsiderTradeTrace
          || trace?.meta?.isDisclosureTrace
          || trace?.meta?.isAiReportMarkerTrace;
        if (!isPriorityMarker) return [];
        return (trace.x || []).flatMap((date, index) => {
          const x = xAxis?._offset + xAxis?.d2p?.(date);
          const y = yAxis?._offset + yAxis?.l2p?.(Number(trace.y?.[index]));
          return Number.isFinite(x) && Number.isFinite(y) ? [{ x, y }] : [];
        });
      });
      const firstForecastMs = Math.min(...(element.data || [])
        .filter((trace) => trace?.meta?.isAiForecastScenarioTrace)
        .flatMap((trace) => trace.x || [])
        .map(Date.parse)
        .filter(Number.isFinite));
      const candidates = (priceTrace?.x || []).flatMap((date, index) => {
        const time = Date.parse(date);
        const value = Number(priceTrace?.y?.[index]);
        if (!Number.isFinite(time) || !Number.isFinite(value)
          || time < range[0] || time > range[1]) return [];
        const x = xAxis._offset + xAxis.d2p(date);
        const y = yAxis._offset + yAxis.l2p(value);
        const markerClearance = priorityPoints.length
          ? Math.min(...priorityPoints.map((point) => Math.hypot(x - point.x, y - point.y)))
          : Number.POSITIVE_INFINITY;
        return [{ index, time, x, y, markerClearance, distance: Math.abs(time - midpoint) }];
      }).sort((left, right) => left.distance - right.distance);
      const candidate = candidates.find((item) => (
        item.markerClearance > 32
        && (!Number.isFinite(firstForecastMs) || item.time < firstForecastMs - (10 * 86400000))
      )) || candidates.find((item) => item.markerClearance > 32) || candidates[0];
      const pointIndex = candidate?.index ?? -1;
      if (priceTraceIndex < 0 || pointIndex < 0 || !xAxis || !yAxis) return null;
      return {
        seriesKey,
        priceTraceIndex,
        pointIndex,
        x: rect.left + candidate.x,
        y: rect.top + candidate.y,
        priceBefore: Number(priceTrace.y[pointIndex]),
        scenarioBefore: (element.data || [])
          .filter((trace) => trace?.meta?.isAiForecastScenarioTrace
            && trace?.meta?.seriesKey === seriesKey)
          .map((trace) => Number(trace.y?.[0])),
      };
    });
    expect(linkedDrag).not.toBeNull();
    await page.mouse.move(linkedDrag.x, linkedDrag.y);
    await page.mouse.down();
    await page.mouse.move(linkedDrag.x, linkedDrag.y + 24);
    await expect.poll(() => page.evaluate(() => (
      Object.keys(window.ThinkStockE2E.getSeriesTransforms().offsets).length
    ))).toBeGreaterThan(0);
    await expect.poll(() => page.locator("#chart").evaluate((element, before) => {
      const price = element.data?.[before.priceTraceIndex];
      return Math.abs(Number(price?.y?.[before.pointIndex]) - before.priceBefore);
    }, linkedDrag)).toBeGreaterThan(0.1);
    const linkedMovement = await page.locator("#chart").evaluate((element, before) => {
      const price = element.data?.[before.priceTraceIndex];
      const priceDelta = Number(price?.y?.[before.pointIndex]) - before.priceBefore;
      const scenarioDeltas = (element.data || [])
        .filter((trace) => trace?.meta?.isAiForecastScenarioTrace
          && trace?.meta?.seriesKey === before.seriesKey)
        .map((trace, index) => Number(trace.y?.[0]) - before.scenarioBefore[index]);
      return { priceDelta, scenarioDeltas };
    }, linkedDrag);
    expect(Math.abs(linkedMovement.priceDelta)).toBeGreaterThan(0.1);
    expect(linkedMovement.scenarioDeltas).toHaveLength(3);
    expect(linkedMovement.scenarioDeltas.every((delta) => (
      Math.abs(delta - linkedMovement.priceDelta) < 0.05
    ))).toBe(true);
  await page.mouse.up();
  await waitForChartRenderIdle(page);
  const observedEnd = await page.locator("#chart").evaluate((element) => Math.max(
    ...(element.data || [])
      .filter((trace) => !trace?.meta?.isAiForecastScenarioTrace && Array.isArray(trace?.x))
      .flatMap((trace) => trace.x.map((date) => Date.parse(date)).filter(Number.isFinite)),
  ));
  await expect(page.locator("#aiForecastProgress")).toBeHidden({ timeout: 5000 });

  const forecastPrices = () => page.locator("#chart").evaluate((element) => (
    (element.data || []).find((trace) => trace?.meta?.isAiForecastTrace)?.customdata || []
  ));
  const baselineForecast = await forecastPrices();

  await page.locator("#chartRange1Year").click();
  await expect.poll(() => page.evaluate(() => window.ThinkStockE2E.getActiveMonths())).toBe(12);
  await expect.poll(() => page.locator("#chart").evaluate((element) => {
    const range = (element?._fullLayout?.xaxis?.range || []).map(Date.parse);
    return (range[1] - range[0]) / (24 * 60 * 60 * 1000);
  })).toBeLessThanOrEqual(370);
  const panState = await page.locator("#chart").evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const xAxis = element?._fullLayout?.xaxis;
    const yAxis = element?._fullLayout?.yaxis;
    const panRatios = [0.2, 0.9];
    const targetTimes = panRatios.map((ratio) => Date.parse(
      xAxis.p2d(xAxis._length * ratio),
    ));
    const occupiedY = [];
    const interpolateAt = (trace, targetTime) => {
      const points = (trace.x || []).flatMap((date, index) => {
        const time = Date.parse(date);
        const value = Number(trace.y?.[index]);
        return Number.isFinite(time) && Number.isFinite(value) ? [{ time, value }] : [];
      }).sort((left, right) => left.time - right.time);
      if (!points.length || targetTime < points[0].time || targetTime > points.at(-1).time) return null;
      let right = points.findIndex((point) => point.time >= targetTime);
      if (right < 0) return null;
      if (points[right].time === targetTime || right === 0) return points[right].value;
      const left = points[right - 1];
      const span = points[right].time - left.time;
      return span > 0
        ? left.value + ((points[right].value - left.value) * (targetTime - left.time) / span)
        : left.value;
    };
    (element.data || []).forEach((trace) => {
      if (trace?.visible === "legendonly" || !Array.isArray(trace?.x) || !Array.isArray(trace?.y)) return;
      targetTimes.forEach((targetTime) => {
        const value = interpolateAt(trace, targetTime);
        const pixel = Number.isFinite(value) ? Number(yAxis.l2p(value)) : NaN;
        if (Number.isFinite(pixel)) occupiedY.push(pixel);
      });
    });
    const safeLocalY = [0.08, 0.2, 0.35, 0.5, 0.65, 0.8, 0.92]
      .map((ratio) => yAxis._length * ratio)
      .sort((left, right) => {
        const clearance = (value) => occupiedY.length
          ? Math.min(...occupiedY.map((occupied) => Math.abs(occupied - value)))
          : yAxis._length;
        return clearance(right) - clearance(left);
      })[0];
    const forecastDates = (element.data || [])
      .filter((trace) => trace?.meta?.isAiForecastScenarioTrace)
      .flatMap((trace) => trace.x || [])
      .map(Date.parse)
      .filter(Number.isFinite);
    const observedDates = (element.data || [])
      .filter((trace) => trace?.meta?.seriesKey && !trace?.meta?.isAiForecastScenarioTrace)
      .flatMap((trace) => trace.x || [])
      .map(Date.parse)
      .filter(Number.isFinite);
    return {
      earlierX: rect.left + xAxis._offset + xAxis._length * 0.2,
      laterX: rect.left + xAxis._offset + xAxis._length * 0.9,
      y: rect.top + yAxis._offset + safeLocalY,
      forecastEnd: Math.max(...forecastDates),
      observedEnd: Math.max(...observedDates),
      traceCount: (element.data || []).filter((trace) => trace?.meta?.isAiForecastScenarioTrace).length,
    };
  });
  const panChart = async (fromX, toX) => {
    const previousStart = await page.locator("#chart").evaluate((element) => (
      Date.parse(element?._fullLayout?.xaxis?.range?.[0])
    ));
    const gestureY = await page.locator("#chart").evaluate((element, clientX) => {
      const rect = element.getBoundingClientRect();
      const xAxis = element._fullLayout.xaxis;
      const yAxis = element._fullLayout.yaxis;
      const localX = clientX - rect.left - xAxis._offset;
      const targetTime = Date.parse(xAxis.p2d(localX));
      const occupiedY = (element.data || []).flatMap((trace) => {
        if (trace?.visible === "legendonly" || !Array.isArray(trace?.x) || !Array.isArray(trace?.y)) return [];
        const points = trace.x.flatMap((date, index) => {
          const time = Date.parse(date);
          const value = Number(trace.y[index]);
          return Number.isFinite(time) && Number.isFinite(value) ? [{ time, value }] : [];
        }).sort((left, right) => left.time - right.time);
        if (!points.length || targetTime < points[0].time || targetTime > points.at(-1).time) return [];
        let right = points.findIndex((point) => point.time >= targetTime);
        if (right < 0) return [];
        let value = points[right].value;
        if (points[right].time !== targetTime && right > 0) {
          const left = points[right - 1];
          const span = points[right].time - left.time;
          if (span > 0) value = left.value + ((value - left.value) * (targetTime - left.time) / span);
        }
        const pixel = Number(yAxis.l2p(value));
        return Number.isFinite(pixel) ? [pixel] : [];
      });
      const localY = [0.08, 0.2, 0.35, 0.5, 0.65, 0.8, 0.92]
        .map((ratio) => yAxis._length * ratio)
        .sort((left, right) => {
          const clearance = (value) => occupiedY.length
            ? Math.min(...occupiedY.map((occupied) => Math.abs(occupied - value)))
            : yAxis._length;
          return clearance(right) - clearance(left);
        })[0];
      return rect.top + yAxis._offset + localY;
    }, fromX);
    if (isMobile) {
      await page.locator("#chart").evaluate(async (element, gesture) => {
        const pointerId = 181;
        const dispatch = (target, type, x, buttons) => target.dispatchEvent(new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          pointerId,
          pointerType: "touch",
          isPrimary: true,
          buttons,
          clientX: x,
          clientY: gesture.y,
        }));
        dispatch(element, "pointerdown", gesture.fromX, 1);
        for (let step = 1; step <= 6; step += 1) {
          dispatch(window, "pointermove", gesture.fromX + ((gesture.toX - gesture.fromX) * step / 6), 1);
          await new Promise(requestAnimationFrame);
        }
        dispatch(window, "pointerup", gesture.toX, 0);
      }, { fromX, toX, y: gestureY });
    } else {
      await page.mouse.move(fromX, gestureY);
      await page.mouse.down();
      await page.mouse.move(toX, gestureY, { steps: 6 });
      await page.mouse.up();
    }
    await expect.poll(() => page.locator("#chart").evaluate((element) => (
      Date.parse(element?._fullLayout?.xaxis?.range?.[0])
    ))).not.toBe(previousStart);
    await waitForChartRenderIdle(page);
  };

  await panChart(panState.earlierX, panState.laterX);
  await expect.poll(() => page.locator("#chart").evaluate((element) => (
    Date.parse(element?._fullLayout?.xaxis?.range?.[1])
  ))).toBeLessThan(panState.observedEnd);
  await expect.poll(() => page.locator("#chart").evaluate((element) => (
    (element.data || []).filter((trace) => trace?.meta?.isAiForecastScenarioTrace).length
  ))).toBe(panState.traceCount);

  await panChart(panState.laterX, panState.earlierX);
  await expect.poll(() => page.locator("#chart").evaluate((element) => (
    Date.parse(element?._fullLayout?.xaxis?.range?.[1])
  ))).toBeGreaterThanOrEqual(panState.forecastEnd - (24 * 60 * 60 * 1000));
  await expect.poll(forecastPrices).toEqual(baselineForecast);

  const latestZoom = await page.locator("#chart").evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const xAxis = element._fullLayout.xaxis;
    const yAxis = element._fullLayout.yaxis;
    const range = xAxis.range.map(Date.parse);
    return {
      x: rect.left + xAxis._offset + (xAxis._length * 0.25),
      y: rect.top + yAxis._offset + (yAxis._length * 0.5),
      span: range[1] - range[0],
    };
  });
  if (isMobile) {
    await page.locator("#chart").evaluate((element, point) => {
      const send = (type, pointerId, x, primary, buttons) => element.dispatchEvent(new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        pointerId,
        pointerType: "touch",
        isPrimary: primary,
        buttons,
        clientX: x,
        clientY: point.y,
      }));
      send("pointerdown", 191, point.x - 35, true, 1);
      send("pointerdown", 192, point.x + 35, false, 1);
      send("pointermove", 191, point.x - 70, true, 1);
      send("pointermove", 192, point.x + 70, false, 1);
      send("pointerup", 191, point.x - 70, true, 0);
      send("pointerup", 192, point.x + 70, false, 0);
    }, latestZoom);
  } else {
    await page.locator("#chart").dispatchEvent("wheel", {
      deltaY: -120,
      clientX: latestZoom.x,
      clientY: latestZoom.y,
    });
  }
  await expect.poll(() => page.locator("#chart").evaluate((element) => {
    const range = element._fullLayout.xaxis.range.map(Date.parse);
    return range[1] - range[0];
  })).toBeLessThan(latestZoom.span * 0.9);
  await expect.poll(() => page.locator("#chart").evaluate((element, forecastEnd) => (
    Math.abs(Date.parse(element._fullLayout.xaxis.range[1]) - forecastEnd)
  ), panState.forecastEnd)).toBeLessThanOrEqual(2 * 24 * 60 * 60 * 1000);

  for (const months of [3, 6, 12, 360]) {
    await setChartRangeMonths(page, months);
    await expect.poll(forecastPrices).toEqual(baselineForecast);
  }

  await page.locator("#aiForecastToggle").click();
  await expect.poll(() => page.locator("#chart").evaluate((element) => (
    (element.data || []).filter((trace) => trace?.meta?.isAiForecastTrace).length
  ))).toBe(0);
  await expect.poll(() => page.locator("#chart").evaluate((element) => (
    Date.parse(element?._fullLayout?.xaxis?.range?.[1])
  ))).toBeLessThanOrEqual(observedEnd);

  const historicalRange = await page.locator("#chart").evaluate((element) => {
    const timestamps = (element.data || [])
      .filter((trace) => (
        trace?.meta?.seriesKey
        && !trace?.meta?.isAiForecastTrace
        && !trace?.meta?.isEpsTrace
        && !trace?.meta?.isGroupedHoverTrace
        && String(trace?.mode || "").includes("lines")
      ))
      .flatMap((trace) => (trace.x || []).map(Date.parse).filter(Number.isFinite));
    const dataStart = Math.min(...timestamps);
    const dataEnd = Math.max(...timestamps);
    const dataSpan = dataEnd - dataStart;
    const start = dataStart + (dataSpan * 0.2);
    return [start, Math.min(dataEnd - (30 * 86400000), start + (365 * 86400000))];
  });
  await page.evaluate((range) => window.ThinkStockE2E.setViewportRangeForTest(range), historicalRange);
  await expect.poll(() => page.locator("#chart").evaluate((element, expected) => {
    const actual = element._fullLayout.xaxis.range.map(Date.parse);
    return Math.max(Math.abs(actual[0] - expected[0]), Math.abs(actual[1] - expected[1]));
  }, historicalRange)).toBeLessThanOrEqual(1000);

  await page.locator("#aiForecastToggle").click();
  await expect.poll(() => page.locator("#chart").evaluate((element) => (
    (element.data || []).filter((trace) => trace?.meta?.isAiForecastTrace).length
  )), { timeout: 30000 }).toBeGreaterThan(0);
  await expect.poll(() => page.locator("#chart").evaluate((element, expected) => {
    const actual = element._fullLayout.xaxis.range.map(Date.parse);
    return Math.max(Math.abs(actual[0] - expected[0]), Math.abs(actual[1] - expected[1]));
  }, historicalRange)).toBeLessThanOrEqual(1000);

  await page.locator("#aiForecastToggle").click();
  await expect.poll(() => page.locator("#chart").evaluate((element) => (
    (element.data || []).filter((trace) => trace?.meta?.isAiForecastTrace).length
  ))).toBe(0);
  await expect.poll(() => page.locator("#chart").evaluate((element, expected) => {
    const actual = element._fullLayout.xaxis.range.map(Date.parse);
    return Math.max(Math.abs(actual[0] - expected[0]), Math.abs(actual[1] - expected[1]));
  }, historicalRange)).toBeLessThanOrEqual(1000);
});

test("AI explains insufficient price history and fades the message", async ({ page }) => {
  await installDataRoutes(page, { shortStockHistory: true });
  await stubExternalRefreshes(page);
  await page.addInitScript(() => {
    localStorage.setItem("thinkstock-v5", JSON.stringify({
      activeMonths: 12,
      hiddenSeries: [
        "leading_cycle", "^KS11", "^KQ11", "customer_deposit", "kospi_credit", "kosdaq_credit",
      ],
      customStocks: [{
        ticker: "005930.KS",
        name: "삼성전자",
        code: "005930",
        market: "KOSPI",
      }],
    }));
  });
  await page.goto("/?e2e=1", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#chart .main-svg").first()).toBeVisible();

  await page.locator("#aiForecastToggle").click();
  const message = page.locator("#chartNavigationMessage");
  await expect(message).toHaveText("삼성전자 · AI 계산 불가: 가격 이력 3년 미만", { timeout: 30000 });
  await expect(message).toBeVisible();
  await expect.poll(() => message.evaluate((element) => element.classList.contains("is-fading")), {
    timeout: 4000,
  }).toBe(true);
  await expect(message).toBeHidden({ timeout: 2500 });
});

test("AI toggle restores an unchanged wheel-zoomed viewport", async ({ page, isMobile }) => {
  test.skip(isMobile, "Mouse wheel behavior is desktop-only.");
  await stubExternalRefreshes(page);
  await page.goto("/?e2e=1", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#chart .main-svg").first()).toBeVisible();

  const initial = await page.locator("#chart").evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const xAxis = element._fullLayout.xaxis;
    const yAxis = element._fullLayout.yaxis;
    const range = xAxis.range.map(Date.parse);
    return {
      x: rect.left + xAxis._offset + (xAxis._length * 0.25),
      y: rect.top + yAxis._offset + (yAxis._length * 0.5),
      span: range[1] - range[0],
    };
  });
  await page.locator("#chart").dispatchEvent("wheel", {
    deltaY: -120,
    clientX: initial.x,
    clientY: initial.y,
  });
  await expect.poll(() => page.locator("#chart").evaluate((element) => {
    const range = element._fullLayout.xaxis.range.map(Date.parse);
    return range[1] - range[0];
  })).toBeLessThan(initial.span * 0.9);
  await page.waitForTimeout(220);
  const zoomedRange = await page.locator("#chart").evaluate((element) => (
    element._fullLayout.xaxis.range.map(Date.parse)
  ));

  await page.locator("#aiForecastToggle").click();
  await expect.poll(() => page.locator("#chart").evaluate((element) => (
    (element.data || []).filter((trace) => trace?.meta?.isAiForecastTrace).length
  )), { timeout: 30000 }).toBeGreaterThan(0);
  await expect(page.locator("#aiForecastToggle")).toHaveAttribute("aria-busy", "false", {
    timeout: 30000,
  });
  await page.locator("#aiForecastToggle").click();
  await expect.poll(() => page.locator("#chart").evaluate((element) => (
    (element.data || []).filter((trace) => trace?.meta?.isAiForecastTrace).length
  ))).toBe(0);
  await waitForChartRenderIdle(page);
  await expect.poll(() => page.locator("#chart").evaluate((element, expected) => {
    const actual = element._fullLayout.xaxis.range.map(Date.parse);
    return Math.max(Math.abs(actual[0] - expected[0]), Math.abs(actual[1] - expected[1]));
  }, zoomedRange)).toBeLessThanOrEqual(1000);
});

test("AI forecast opens for the first enabled series and stays stable while browsing history", async ({ page }) => {
  const pageUrl = process.env.THINKSTOCK_AI_EMPTY_BOOT_URL || "/?e2e=1";
  await stubExternalRefreshes(page);
  await page.addInitScript(() => {
    localStorage.setItem("thinkstock-v5", JSON.stringify({
      activeMonths: 120,
      hiddenSeries: [
        "leading_cycle",
        "t10y1y",
        "us_credit_spread",
        "^KS11",
        "^KQ11",
        "customer_deposit",
        "kospi_credit",
        "kosdaq_credit",
      ],
      customStocks: [],
    }));
  });
  await page.goto(pageUrl, { waitUntil: "domcontentloaded" });
  await expect(page.locator("#chart .main-svg").first()).toBeVisible();
  await expect(page.locator('.series-toggle-btn[data-series="^KS11"]')).toHaveClass(/is-off/);

  await page.locator("#aiForecastToggle").click();
  await expect(page.locator("#aiForecastToggle")).toHaveAttribute("aria-pressed", "true");
  await page.locator('.series-toggle-btn[data-series="^KS11"]').click();
  await expect(page.locator('.series-toggle-btn[data-series="^KS11"]')).toHaveClass(/is-on/);
  await expect.poll(() => page.locator("#chart").evaluate((element) => (
    (element.data || []).filter((trace) => (
      trace?.meta?.isAiForecastScenarioTrace && trace?.meta?.seriesKey === "^KS11"
    )).length
  )), {
    message: "KOSPI AI forecast did not render after an empty boot",
    timeout: 30000,
  }).toBe(3);
  const visibleRange = await page.locator("#chart").evaluate((element) => {
    const observedEnd = Math.max(
      ...(element.data || [])
        .filter((trace) => !trace?.meta?.isAiForecastScenarioTrace && Array.isArray(trace?.x))
        .flatMap((trace) => trace.x.map((date) => Date.parse(date)).filter(Number.isFinite)),
    );
    return {
      observedEnd,
      forecastEnd: Math.max(
        ...(element.data || [])
          .filter((trace) => trace?.meta?.isAiForecastScenarioTrace && Array.isArray(trace?.x))
          .flatMap((trace) => trace.x.map((date) => Date.parse(date)).filter(Number.isFinite)),
      ),
      viewportEnd: Date.parse(element?._fullLayout?.xaxis?.range?.[1]),
    };
  });
  expect(visibleRange.viewportEnd).toBeGreaterThan(visibleRange.observedEnd);
  expect(visibleRange.viewportEnd).toBeGreaterThanOrEqual(visibleRange.forecastEnd);

  await expect.poll(() => page.evaluate(() => {
    const state = window.ThinkStockE2E.getAiForecastState();
    const refresh = window.ThinkStockE2E.getRefreshPhaseStats();
    return state.marketModelSettled && !state.inputsPending && refresh.supplementalReady > 0;
  }), { timeout: 20000 }).toBe(true);
  await expect(page.locator("#aiForecastProgress")).toBeHidden({ timeout: 10000 });

  const latestForecastPaths = await page.locator("#chart").evaluate((element) => (
    Object.fromEntries((element.data || [])
      .filter((trace) => trace?.meta?.isAiForecastScenarioTrace && trace?.meta?.seriesKey === "^KS11")
      .map((trace) => [trace.meta.aiTraceRole, [...(trace.customdata || [])]]))
  ));
  const calculationCountsBeforeHistory = await page.evaluate(() => (
    window.ThinkStockE2E.getAiForecastState().calculationCounts
  ));
  const inputKeysBeforeHistory = await page.evaluate(() => (
    window.ThinkStockE2E.getAiForecastState().cacheInputKeys
  ));
  const actualInputDate = new Date(visibleRange.observedEnd).toISOString().slice(0, 10);
  expect(await page.evaluate(({ date }) => window.ThinkStockE2E.applyNewsSentimentForTest([
    { date, news_sentiment: 123.456 },
  ]), { date: actualInputDate })).toMatchObject({ updated: 1, latestDate: actualInputDate });
  await expect.poll(() => page.evaluate(() => (
    window.ThinkStockE2E.getAiForecastState().calculationCounts["^KS11"] || 0
  )), {
    message: "A real macro input change did not recalculate the affected forecast",
    timeout: 30000,
  })
    .toBe((calculationCountsBeforeHistory["^KS11"] || 0) + 1);
  const stateAfterInputChange = await page.evaluate(() => window.ThinkStockE2E.getAiForecastState());
  expect(stateAfterInputChange.cacheInputKeys["^KS11"])
    .not.toBe(inputKeysBeforeHistory["^KS11"]);
});

test("AI off clamps the viewport to the last observed date", async ({ page }) => {
  await stubExternalRefreshes(page);
  await page.goto("/?e2e=1", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#chart .main-svg").first()).toBeVisible();

  await page.locator("#aiForecastToggle").click();
  await expect.poll(() => page.locator("#chart").evaluate((element) => (
    (element.data || []).filter((trace) => trace?.meta?.isAiForecastScenarioTrace).length
  )), { timeout: 30000 }).toBeGreaterThan(0);
  const observedEnd = await page.locator("#chart").evaluate((element) => Math.max(
    ...(element.data || [])
      .filter((trace) => !trace?.meta?.isAiForecastScenarioTrace && Array.isArray(trace?.x))
      .flatMap((trace) => trace.x.map((date) => Date.parse(date)).filter(Number.isFinite)),
  ));
  await expect.poll(() => page.locator("#chart").evaluate((element) => (
    Date.parse(element?._fullLayout?.xaxis?.range?.[1])
  ))).toBeGreaterThan(observedEnd);

  await page.locator("#aiForecastToggle").click();
  await expect.poll(() => page.locator("#chart").evaluate((element) => (
    (element.data || []).filter((trace) => trace?.meta?.isAiForecastScenarioTrace).length
  ))).toBe(0);
  await expect.poll(() => page.locator("#chart").evaluate((element) => (
    Date.parse(element?._fullLayout?.xaxis?.range?.[1])
  ))).toBeLessThanOrEqual(observedEnd);
});

test("AI forecasts survive repeated KOSPI and KOSDAQ toggle cycles", async ({ page }) => {
  test.setTimeout(75_000);
  await stubExternalRefreshes(page);
  await page.goto("/?e2e=1", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#chart .main-svg").first()).toBeVisible();
  const kosdaqButton = page.locator('.series-toggle-btn[data-series="^KQ11"]');
  if (await kosdaqButton.getAttribute("aria-pressed") !== "true") await kosdaqButton.click();
  await page.evaluate(() => {
    const bar = document.getElementById("aiForecastProgressBar");
    const text = document.getElementById("aiForecastProgressText");
    window.__aiProgressSamples = [];
    const capture = () => window.__aiProgressSamples.push({
      value: Number.parseFloat(bar?.style?.width || "0"),
      text: text?.textContent || "",
    });
    new MutationObserver(capture).observe(bar, { attributes: true, attributeFilter: ["style"] });
    new MutationObserver(capture).observe(text, { childList: true, subtree: true });
  });

  let calculationCountsAfterInitial = null;
  for (let cycle = 0; cycle < 5; cycle += 1) {
    await page.locator("#aiForecastToggle").click();
    await expect(page.locator("#aiForecastToggle")).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => page.locator("#chart").evaluate((element) => (
      new Set((element.data || [])
        .filter((trace) => trace?.meta?.isAiForecastScenarioTrace)
        .map((trace) => trace?.meta?.seriesKey)).size
    )), {
      message: `AI cycle ${cycle + 1} did not render both indices`,
      timeout: 30000,
    }).toBe(2);
    if (cycle === 0) {
      // The first visible forecast can be refined once the background market
      // model and rotation inputs settle. Measure cache reuse after that pass.
      await expect(page.locator("#aiForecastProgress")).toBeHidden({ timeout: 15000 });
      calculationCountsAfterInitial = await page.evaluate(() => (
        window.ThinkStockE2E.getAiForecastState().calculationCounts
      ));
    }

    await page.locator("#aiForecastToggle").click();
    await expect(page.locator("#aiForecastToggle")).toHaveAttribute("aria-pressed", "false");
    await expect.poll(() => page.locator("#chart").evaluate((element) => (
      (element.data || []).filter((trace) => trace?.meta?.isAiForecastScenarioTrace).length
    ))).toBe(0);
  }

  for (let click = 0; click < 5; click += 1) {
    await page.locator("#aiForecastToggle").click();
    await page.waitForTimeout(40);
  }
  await expect(page.locator("#aiForecastToggle")).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => page.locator("#chart").evaluate((element) => (
    new Set((element.data || [])
      .filter((trace) => trace?.meta?.isAiForecastScenarioTrace)
      .map((trace) => trace?.meta?.seriesKey)).size
  )), {
    message: "rapid AI toggles did not preserve the final ON state",
    timeout: 30000,
  }).toBe(2);
  const progressSamples = await page.evaluate(() => window.__aiProgressSamples || []);
  expect(progressSamples.some((sample) => sample.value === 100)).toBe(true);
  const finalCalculationCounts = await page.evaluate(() => (
    window.ThinkStockE2E.getAiForecastState().calculationCounts
  ));
  expect(finalCalculationCounts).toEqual(calculationCountsAfterInitial);
});

test("enabling KOSDAQ while AI is active calculates only the new index", async ({ page }) => {
  await stubExternalRefreshes(page);
  await page.addInitScript(() => {
    localStorage.setItem("thinkstock-v5", JSON.stringify({
      activeMonths: 12,
      hiddenSeries: [
        "leading_cycle",
        "t10y1y",
        "us_credit_spread",
        "^KQ11",
        "customer_deposit",
        "kospi_credit",
        "kosdaq_credit",
      ],
      customStocks: [],
    }));
  });
  await page.goto("/?e2e=1", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#chart .main-svg").first()).toBeVisible();

  await page.locator("#aiForecastToggle").click();
  await expect.poll(() => page.locator("#chart").evaluate((element) => (
    (element.data || []).filter((trace) => (
      trace?.meta?.isAiForecastScenarioTrace && trace?.meta?.seriesKey === "^KS11"
    )).length
  )), { timeout: 30000 }).toBe(3);
  await expect.poll(() => page.evaluate(() => {
    const state = window.ThinkStockE2E.getAiForecastState();
    return state.marketModelSettled && !state.inputsPending;
  }), { timeout: 20000 }).toBe(true);
  await expect(page.locator("#aiForecastProgress")).toBeHidden({ timeout: 10000 });
  const countsBeforeKOSDAQ = await page.evaluate(() => (
    window.ThinkStockE2E.getAiForecastState().calculationCounts
  ));
  expect(countsBeforeKOSDAQ["^KS11"]).toBe(1);

  await page.evaluate(() => {
    const wrap = document.getElementById("aiForecastProgress");
    window.__kosdaqAiProgressVisibility = [];
    const capture = () => window.__kosdaqAiProgressVisibility.push(!wrap?.hidden);
    new MutationObserver(capture).observe(wrap, { attributes: true, attributeFilter: ["hidden"] });
  });
  await page.locator('.series-toggle-btn[data-series="^KQ11"]').click();
  await expect(page.locator("#aiForecastProgress")).toBeVisible();
  await expect.poll(() => page.locator("#chart").evaluate((element) => (
    (element.data || []).filter((trace) => (
      trace?.meta?.isAiForecastScenarioTrace && trace?.meta?.seriesKey === "^KQ11"
    )).length
  )), { timeout: 30000 }).toBe(3);
  await expect(page.locator("#aiForecastProgress")).toBeHidden({ timeout: 5000 });
  expect(await page.evaluate(() => window.__kosdaqAiProgressVisibility || [])).toContain(true);
  const stateAfterKOSDAQ = await page.evaluate(() => window.ThinkStockE2E.getAiForecastState());
  expect(stateAfterKOSDAQ.calculationCounts["^KS11"]).toBe(countsBeforeKOSDAQ["^KS11"]);
  expect(stateAfterKOSDAQ.calculationCounts["^KQ11"]).toBe(1);
  expect(stateAfterKOSDAQ.cachedTargets).toEqual(expect.arrayContaining(["^KS11", "^KQ11"]));
});

test("AI requests analysis only for stock toggles that are on", async ({ page }) => {
  await installDataRoutes(page);
  const stockSeries = ["005930.KS", "000660.KS", "035420.KS", "035720.KS"];
  await page.route("**/data/prices_recent.json*", async (route) => {
    await route.fulfill({ json: columnar(
      ["^KS11", "^KQ11", ...stockSeries],
      recentDates,
      {
        "^KS11": [2800, 2900, 3000, 3100, 3200],
        "^KQ11": [780, 800, 820, 840, 860],
        "005930.KS": [70000, 72000, 74000, 76000, 78000],
        "000660.KS": [90000, 88000, 91000, 93000, 95000],
        "035420.KS": [180000, 185000, 183000, 190000, 195000],
        "035720.KS": [45000, 47000, 46000, 48000, 50000],
      },
    ) });
  });
  await page.route("**/data/prices_history.json*", async (route) => {
    await route.fulfill({ json: columnar(
      ["^KS11", "^KQ11", ...stockSeries],
      historyDates,
      {
        "^KS11": [300, 900, 1800],
        "^KQ11": [80, 400, 550],
        "005930.KS": [8000, 15000, 28000],
        "000660.KS": [12000, 28000, 52000],
        "035420.KS": [25000, 60000, 110000],
        "035720.KS": [10000, 22000, 35000],
      },
    ) });
  });
  await page.addInitScript(() => {
    localStorage.setItem("thinkstock-dart-gateway-v1", JSON.stringify({ accessToken: "private" }));
    localStorage.setItem("thinkstock-v5", JSON.stringify({
      activeMonths: 12,
      hiddenSeries: [
        "leading_cycle", "^KS11", "^KQ11", "customer_deposit", "kospi_credit", "kosdaq_credit",
        "000660.KS", "035720.KS",
      ],
      customStocks: [
        { ticker: "005930.KS", name: "삼성전자", code: "005930", market: "KOSPI" },
        { ticker: "000660.KS", name: "SK하이닉스", code: "000660", market: "KOSPI" },
        { ticker: "035420.KS", name: "NAVER", code: "035420", market: "KOSPI" },
        { ticker: "035720.KS", name: "카카오", code: "035720", market: "KOSPI" },
      ],
    }));
  });
  const analysisRequests = [];
  await page.route("**/api/analysis**", async (route) => {
    const ticker = new URL(route.request().url()).searchParams.get("ticker") || "";
    analysisRequests.push(ticker);
    await route.fulfill({ json: { ok: true, ticker, savedAt: Date.now(), financials: [] } });
  });

  await page.goto("/?e2e=1", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#chart .main-svg").first()).toBeVisible();
  await page.locator("#aiForecastToggle").click();

  await expect.poll(() => [...new Set(analysisRequests)].sort())
    .toEqual(["005930.KS", "035420.KS"]);
  await page.waitForTimeout(300);
  expect([...new Set(analysisRequests)].sort()).toEqual(["005930.KS", "035420.KS"]);
  await expect.poll(() => page.evaluate(() => window.ThinkStockE2E.getAiForecastState().targets))
    .toEqual(["005930.KS", "035420.KS"]);
});

test("market timing applies to a visible stock series", async ({ page }) => {
  await installDataRoutes(page);
  const timingDates = Array.from({ length: 1300 }, (_, index) => (
    new Date(Date.UTC(2023, 0, 1 + index)).toISOString().slice(0, 10)
  ));
  const marketPrices = timingDates.map((_, index) => 2400 + (index * 0.35));
  const stockPrices = timingDates.map((_, index) => 52000 + (index * 18));
  stockPrices[650] = stockPrices[649] * 1.3;
  stockPrices[stockPrices.length - 1] = stockPrices.at(-2) * 1.3;
  const recentStart = 850;
  await page.route("**/data/prices_recent.json*", async (route) => {
    await route.fulfill({ json: columnar(
      ["^KS11", "^KQ11", "005930.KS"],
      timingDates.slice(recentStart),
      {
        "^KS11": marketPrices.slice(recentStart),
        "^KQ11": marketPrices.slice(recentStart).map((value) => value * 0.28),
        "005930.KS": stockPrices.slice(recentStart),
      },
    ) });
  });
  await page.route("**/data/prices_history.json*", async (route) => {
    await route.fulfill({ json: columnar(
      ["^KS11", "^KQ11", "005930.KS"],
      timingDates.slice(0, recentStart),
      {
        "^KS11": marketPrices.slice(0, recentStart),
        "^KQ11": marketPrices.slice(0, recentStart).map((value) => value * 0.28),
        "005930.KS": stockPrices.slice(0, recentStart),
      },
    ) });
  });
  await page.addInitScript(() => {
    localStorage.setItem("thinkstock-v5", JSON.stringify({
      activeMonths: 360,
      customStocks: [
        { ticker: "005930.KS", name: "삼성전자", code: "005930", market: "KOSPI" },
      ],
      showDisclosures: true,
      showInsiderTrades: true,
      showRecessionSignals: true,
    }));
  });
  await page.goto("/?e2e=1", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#chart .main-svg").first()).toBeVisible();

  await expect.poll(() => page.locator("#chart").evaluate((element) => (
    (element.data || [])
      .filter((trace) => trace?.meta?.isMarketTimingBuyTrace || trace?.meta?.isMarketTimingSellTrace)
      .flatMap((trace) => trace.customdata || [])
      .some((row) => row?.[0] === "삼성전자")
  ))).toBe(true);
  const historicalMarkerCoverage = await page.locator("#chart").evaluate((element) => {
    const viewportStart = Date.parse(element?._fullLayout?.xaxis?.range?.[0] || "");
    const markerDates = (element.data || [])
      .filter((trace) => trace?.meta?.isMarketTimingBuyTrace || trace?.meta?.isMarketTimingSellTrace)
      .flatMap((trace) => trace.x || [])
      .map((date) => Date.parse(date))
      .filter(Number.isFinite);
    return {
      markerCount: markerDates.length,
      hasMarkerBeforeViewport: markerDates.some((date) => date < viewportStart),
    };
  });
  expect(historicalMarkerCoverage.markerCount).toBeGreaterThan(1);
  expect(historicalMarkerCoverage.hasMarkerBeforeViewport).toBe(true);
  const timingMarkerStyles = await page.locator("#chart").evaluate((element) => (
    (element.data || [])
      .filter((trace) => trace?.meta?.isMarketTimingBuyTrace || trace?.meta?.isMarketTimingSellTrace)
      .map((trace) => ({ text: trace.text?.[0], size: trace.textfont?.size }))
  ));
  expect(timingMarkerStyles.length).toBeGreaterThan(0);
  expect(timingMarkerStyles.every(({ text, size }) => (
    ["▲", "▼"].includes(text) && size === 15
  ))).toBe(true);

  const maximumTimingMarkerGap = async () => {
    const gaps = await page.evaluate(() => window.ThinkStockE2E.getTimingMarkerPixelGaps());
    return gaps.length ? Math.max(...gaps) : Number.POSITIVE_INFINITY;
  };

  await page.locator("#apiOptionsBtn").click();
  await page.locator("#chartRightPaddingIncrease").evaluate((button) => {
    for (let index = 0; index < 5; index += 1) button.click();
  });
  await expect(page.locator("#chartRightPaddingValue")).toHaveText("5");
  const fiveDayMarkerGaps = await page.evaluate(() => window.ThinkStockE2E.getTimingMarkerPixelGaps());
  expect(fiveDayMarkerGaps.length).toBeGreaterThan(0);
  await page.locator("#chartRightPaddingIncrease").evaluate((button) => {
    for (let index = 0; index < 5; index += 1) button.click();
  });
  await expect(page.locator("#chartRightPaddingValue")).toHaveText("10");
  await expect.poll(async () => {
    const gaps = await page.evaluate(() => window.ThinkStockE2E.getTimingMarkerPixelGaps());
    if (gaps.length !== fiveDayMarkerGaps.length) return Number.POSITIVE_INFINITY;
    return gaps.reduce((maximum, value, index) => (
      Math.max(maximum, Math.abs(value - fiveDayMarkerGaps[index]))
    ), 0);
  }).toBeLessThan(0.5);
  await page.locator("#apiSettingsCloseBtn").click();

  await page.locator("#aiForecastToggle").click();
  await expect.poll(() => page.locator("#chart").evaluate((element) => (
    (element.data || []).filter((trace) => trace?.meta?.isAiForecastTrace).length
  )), { timeout: 20000 }).toBeGreaterThan(0);
  await expect.poll(maximumTimingMarkerGap).toBeLessThan(24);

  const rangeBeforeWheel = await page.locator("#chart").evaluate((element) => (
    (element?._fullLayout?.xaxis?.range || []).map((value) => Date.parse(value))
  ));
  const wheelPoint = await page.locator("#chart").evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const axis = element?._fullLayout?.xaxis;
    return {
      x: rect.left + axis._offset + (axis._length * 0.55),
      y: rect.top + axis._offset + 4,
    };
  });
  await page.locator("#chart").evaluate((element, point) => {
    element.dispatchEvent(new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      clientX: point.x,
      clientY: point.y,
      deltaY: -600,
    }));
  }, wheelPoint);
  expect(await page.locator("#chart").evaluate((element) => (
    element.classList.contains("is-series-transform-marker-hidden")
  ))).toBe(false);
  await expect.poll(() => page.locator("#chart").evaluate((element) => {
    const range = (element?._fullLayout?.xaxis?.range || []).map((value) => Date.parse(value));
    return range.length === 2 ? range[1] - range[0] : Number.POSITIVE_INFINITY;
  })).toBeLessThan(rangeBeforeWheel[1] - rangeBeforeWheel[0]);
  await expect(page.locator("#chart")).not.toHaveClass(/is-series-transform-marker-hidden/);
  await expect.poll(maximumTimingMarkerGap).toBeLessThan(24);

  const panStart = await page.locator("#chart").evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const xAxis = element?._fullLayout?.xaxis;
    const yAxis = element?._fullLayout?.yaxis;
    return {
      x: rect.left + xAxis._offset + (xAxis._length * 0.5),
      y: rect.top + yAxis._offset + 3,
    };
  });
  const rangeBeforePan = await page.locator("#chart").evaluate((element) => (
    (element?._fullLayout?.xaxis?.range || []).map((value) => Date.parse(value))
  ));
  await page.mouse.move(panStart.x, panStart.y);
  await page.mouse.down();
  await page.mouse.move(panStart.x + 90, panStart.y, { steps: 5 });
  expect(await page.locator("#chart").evaluate((element) => (
    element.classList.contains("is-series-transform-marker-hidden")
  ))).toBe(false);
  await page.mouse.up();
  await expect.poll(() => page.locator("#chart").evaluate((element) => (
    Date.parse(element?._fullLayout?.xaxis?.range?.[0] || "")
  ))).not.toBe(rangeBeforePan[0]);
  await expect(page.locator("#chart")).not.toHaveClass(/is-series-transform-marker-hidden/);
  await expect.poll(maximumTimingMarkerGap).toBeLessThan(24);

  const kospiToggle = page.locator('.series-toggle-btn[data-series="^KS11"]');
  await kospiToggle.click();
  await expect.poll(maximumTimingMarkerGap).toBeLessThan(24);
  await kospiToggle.click();
  await expect.poll(maximumTimingMarkerGap).toBeLessThan(24);

  await page.locator("#chart").evaluate(async (element) => {
    const range = element?._fullLayout?.xaxis?.range || [];
    const start = Date.parse(range[0]);
    const end = Date.parse(range[1]);
    const middle = start + ((end - start) / 2);
    await window.Plotly.relayout(element, {
      "xaxis.range[0]": new Date(middle - ((end - start) * 0.12)).toISOString(),
      "xaxis.range[1]": new Date(middle + ((end - start) * 0.12)).toISOString(),
    });
  });
  await expect.poll(maximumTimingMarkerGap).toBeLessThan(24);
  const scaleToggle = page.locator("#resetHandles");
  await scaleToggle.click();
  await expect(scaleToggle).toHaveAttribute("aria-pressed", "false");
  await scaleToggle.click();
  await expect(scaleToggle).toHaveAttribute("aria-pressed", "true");
  await expect.poll(maximumTimingMarkerGap).toBeLessThan(24);
});

test("signal calculation shows progress while an uncached timing model is prepared", async ({ page }) => {
  await stubExternalRefreshes(page);
  await page.addInitScript(() => {
    localStorage.setItem("thinkstock-v5", JSON.stringify({
      activeMonths: 12,
      hiddenSeries: [
        "leading_cycle", "^KQ11", "customer_deposit", "kospi_credit", "kosdaq_credit",
      ],
      showRecessionSignals: false,
    }));
    const NativeWorker = window.Worker;
    window.Worker = class DelayedTimingWorker extends NativeWorker {
      constructor(url, options) {
        super(url, options);
        this.isTimingWorker = String(url || "").includes("market-timing-worker");
      }

      postMessage(message, transfer) {
        if (!this.isTimingWorker) {
          if (transfer === undefined) return super.postMessage(message);
          return super.postMessage(message, transfer);
        }
        setTimeout(() => {
          if (transfer === undefined) NativeWorker.prototype.postMessage.call(this, message);
          else NativeWorker.prototype.postMessage.call(this, message, transfer);
        }, 450);
        return undefined;
      }
    };
  });

  await page.goto("/?e2e=1", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#chart .main-svg").first()).toBeVisible();
  await expect.poll(() => page.evaluate(() => (
    window.ThinkStockE2E?.getRuntimeDiagnosticState?.().startupVisualReady || false
  ))).toBe(true);
  await expect(page.locator("#recessionToggle")).toBeEnabled();
  await page.locator("#recessionToggle").click();

  await expect(page.locator("#signalProgress")).toBeVisible();
  await expect(page.locator("#signalProgressText")).toContainText("코스피 신호 로딩중");
  await expect.poll(() => page.evaluate(() => window.ThinkStockE2E.getSignalProgressState()))
    .toMatchObject({ enabled: true, active: 1, visible: true });
  await expect(page.locator("#signalProgress")).toBeHidden({ timeout: 10000 });
  await expect.poll(() => page.locator("#chart").evaluate((element) => (
    (element.data || []).some((trace) => (
      trace?.meta?.isMarketTimingBuyTrace || trace?.meta?.isMarketTimingSellTrace
    ))
  ))).toBe(true);
});

test("timing hover wraps reasons and its shared hit area opens the popover", async ({ page, isMobile }) => {
  await stubExternalRefreshes(page);
  await page.addInitScript(() => {
    localStorage.setItem("thinkstock-v5", JSON.stringify({
      activeMonths: 360,
      customStocks: [
        { ticker: "005930.KS", name: "삼성전자", code: "005930", market: "KOSPI" },
      ],
      showRecessionSignals: true,
    }));
  });
  await page.goto("/?e2e=1", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#chart .main-svg").first()).toBeVisible();

  await expect.poll(() => page.locator("#chart").evaluate((element) => {
    const traceIndex = (element.data || []).findIndex((trace) => (
      (trace?.meta?.isMarketTimingBuyTrace || trace?.meta?.isMarketTimingSellTrace)
      && Array.isArray(trace.x)
      && trace.x.length > 0
    ));
    if (traceIndex < 0) return null;
    const trace = element.data[traceIndex];
    const rect = element.getBoundingClientRect();
    const xaxis = element?._fullLayout?.xaxis;
    const yaxis = element?._fullLayout?.yaxis;
    const x = rect.left + Number(xaxis?._offset || 0) + Number(xaxis?.d2p?.(trace.x?.[0]));
    const y = rect.top + Number(yaxis?._offset || 0) + Number(yaxis?.d2p?.(trace.y?.[0]));
    return Number.isFinite(x) && Number.isFinite(y) ? { x, y, traceIndex } : null;
  }), { timeout: 25000 }).not.toBeNull();

  const target = await page.locator("#chart").evaluate((element) => {
    const traceIndex = (element.data || []).findIndex((trace) => (
      (trace?.meta?.isMarketTimingBuyTrace || trace?.meta?.isMarketTimingSellTrace)
      && Array.isArray(trace.x)
      && trace.x.length > 0
    ));
    const trace = element.data[traceIndex];
    window.Plotly.Fx.hover(element, [{ curveNumber: traceIndex, pointNumber: 0 }]);
    const rect = element.getBoundingClientRect();
    const xaxis = element?._fullLayout?.xaxis;
    const yaxis = element?._fullLayout?.yaxis;
    return {
      x: rect.left + Number(xaxis?._offset || 0) + Number(xaxis?.d2p?.(trace.x?.[0])),
      y: rect.top + Number(yaxis?._offset || 0) + Number(yaxis?.d2p?.(trace.y?.[0])),
    };
  });
  await expect(page.locator("#chart .hoverlayer")).not.toContainText("<br>");
  if (isMobile) await page.touchscreen.tap(target.x + 12, target.y);
  else await page.mouse.click(target.x + 12, target.y);
  await expect(page.locator("#chart .disclosure-popover")).toBeVisible();
  await expect(page.locator("#chart .disclosure-popover")).toContainText("근거:");
});

test("co-movement toggle shows only the last visible stock for the selected period", async ({ page }) => {
  await installDataRoutes(page);
  await page.route("**/data/prices_recent.json*", async (route) => {
    await route.fulfill({ json: columnar(
      ["^KS11", "^KQ11", "005930.KS", "000660.KS"],
      recentDates,
      {
        "^KS11": [2800, 2900, 3000, 3100, 3200],
        "^KQ11": [780, 800, 820, 840, 860],
        "005930.KS": [70000, 72000, 74000, 76000, 78000],
        "000660.KS": [90000, 88000, 91000, 93000, 95000],
      },
    ) });
  });
  await page.addInitScript(() => {
    localStorage.setItem("thinkstock-v5", JSON.stringify({
      activeMonths: 12,
      customStocks: [
        { ticker: "005930.KS", name: "삼성전자", code: "005930", market: "KOSPI" },
        { ticker: "000660.KS", name: "SK하이닉스", code: "000660", market: "KOSPI" },
      ],
      showCoMovement: true,
    }));
  });
  await page.goto("/?e2e=1", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#chart .main-svg").first()).toBeVisible();

  const chartButtonOrder = await Promise.all([
    page.locator("#resetHandles").boundingBox(),
    page.locator("#coMovementToggle").boundingBox(),
    page.locator("#insiderTradeToggle").boundingBox(),
    page.locator("#disclosureToggle").boundingBox(),
    page.locator("#recessionToggle").boundingBox(),
    page.locator("#epsToggle").boundingBox(),
    page.locator("#aiForecastToggle").boundingBox(),
  ]);
  expect(chartButtonOrder.every(Boolean)).toBe(true);
  chartButtonOrder.slice(1).forEach((box, index) => {
    expect(chartButtonOrder[index].y).toBeLessThan(box.y);
  });

  const topControlOrder = await page.locator(".top-controls").evaluate((container) => (
    [...container.children].map((element) => element.id || element.querySelector("#creditOffset")?.id)
  ));
  expect(topControlOrder).toEqual([
    "hoverToggle",
    "chartToolsToggle",
    "chartHandlesToggle",
    "creditOffset",
    "stockResearchBtn",
    "apiOptionsBtn",
  ]);

  await expect(page.locator("#coMovementToggle")).toHaveClass(/is-active/);
  await expect(page.locator("#coMovementPanel")).toBeVisible();
  await expect(page.locator("#coMovementPanel")).toContainText("SK하이닉스 1년");
  await page.locator("#coMovementToggle").click();
  await expect(page.locator("#coMovementPanel")).toBeHidden();
  await page.locator("#coMovementToggle").click();
  await expect(page.locator("#coMovementToggle")).toHaveClass(/is-active/);
  await expect(page.locator("#coMovementPanel")).toBeVisible();
  const coMovementLayout = await page.locator("#coMovementPanel").evaluate((panel) => {
    const chart = document.getElementById("chart");
    const panelRect = panel.getBoundingClientRect();
    const chartRect = chart.getBoundingClientRect();
    const style = getComputedStyle(panel);
    return {
      centerDelta: Math.abs((panelRect.left + panelRect.right) / 2 - (chartRect.left + chartRect.right) / 2),
      bottomOffset: chartRect.bottom - panelRect.bottom,
      borderWidth: style.borderTopWidth,
      backgroundColor: style.backgroundColor,
      padding: style.padding,
      backdropFilter: style.backdropFilter || style.webkitBackdropFilter,
      textShadow: style.textShadow,
    };
  });
  expect(coMovementLayout.centerDelta).toBeLessThanOrEqual(1);
  expect(coMovementLayout.bottomOffset).toBeGreaterThanOrEqual(34);
  expect(coMovementLayout.bottomOffset).toBeLessThanOrEqual(40);
  expect(coMovementLayout.borderWidth).toBe("0px");
  expect(coMovementLayout.backgroundColor).toBe("rgba(0, 0, 0, 0)");
  expect(coMovementLayout.padding).toBe("0px");
  expect(coMovementLayout.backdropFilter).toBe("none");
  expect(coMovementLayout.textShadow).toBe("none");
  await expect(page.locator("#coMovementPanel")).toContainText("SK하이닉스 1년");
  await expect(page.locator("#coMovementPanel")).toContainText("코스피 75%");
  await expect(page.locator("#coMovementPanel")).toContainText("코스닥 75%");
  await expect(page.locator("#coMovementPanel .co-movement-metric")).toHaveCount(2);

  const clickStockLine = async (ticker, date) => {
    const point = await page.locator("#chart").evaluate((element, target) => {
      const trace = (element.data || []).find((item) => item?.meta?.seriesKey === target.ticker);
      const pointIndex = trace?.x?.indexOf(target.date) ?? -1;
      const xAxis = element?._fullLayout?.xaxis;
      const yAxis = element?._fullLayout?.yaxis;
      const rect = element.getBoundingClientRect();
      if (pointIndex < 0 || !xAxis || !yAxis) return null;
      return {
        x: rect.left + Number(xAxis._offset || 0) + xAxis.d2p(trace.x[pointIndex]),
        y: rect.top + Number(yAxis._offset || 0) + yAxis.l2p(Number(trace.y[pointIndex])),
      };
    }, { ticker, date });
    expect(point).not.toBeNull();
    const hit = await page.evaluate(({ x, y }) => {
      const target = window.ThinkStockE2E?.getLineDragTargetAt?.(x, y);
      return target ? { seriesKey: target.seriesKey, traceIndex: target.traceIndex } : null;
    }, point);
    expect(hit?.seriesKey).toBe(ticker);
    await page.mouse.click(point.x, point.y);
  };
  await clickStockLine("005930.KS", "2026-01-14");
  await expect(page.locator("#coMovementPanel")).toContainText("삼성전자 1년");
  await clickStockLine("000660.KS", "2026-01-14");
  await expect(page.locator("#coMovementPanel")).toContainText("SK하이닉스 1년");

  await page.locator('[data-series="000660.KS"]').click();
  await expect(page.locator("#coMovementPanel")).toContainText("삼성전자 1년");
  await page.locator('[data-series="000660.KS"]').click();
  await expect(page.locator("#coMovementPanel")).toContainText("SK하이닉스 1년");

  await setChartRangeMonths(page, 3);
  await expect(page.locator("#coMovementPanel")).toContainText("SK하이닉스 3개월");
  await page.locator("#coMovementToggle").click();
  await expect(page.locator("#coMovementPanel")).toBeHidden();
});

test("co-movement recalculates from the five sessions currently visible", async ({ page }) => {
  const dates = ["2026-01-08", "2026-01-09", "2026-01-12", "2026-01-13", "2026-01-14"];
  await installDataRoutes(page);
  await page.route("**/data/prices_recent.json*", async (route) => {
    await route.fulfill({ json: columnar(
      ["^KS11", "^KQ11", "000660.KS"],
      dates,
      {
        "^KS11": [2800, 2900, 3000, 3100, 3200],
        "^KQ11": [780, 800, 820, 840, 860],
        "000660.KS": [90000, 88000, 91000, 93000, 95000],
      },
    ) });
  });
  await page.addInitScript(() => {
    localStorage.setItem("thinkstock-v5", JSON.stringify({
      activeMonths: 12,
      customStocks: [
        { ticker: "000660.KS", name: "SK하이닉스", code: "000660", market: "KOSPI" },
      ],
      showCoMovement: false,
    }));
  });
  await page.goto("/?e2e=1", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#chart .main-svg").first()).toBeVisible();
  await page.locator("#coMovementToggle").click();
  await expect(page.locator("#coMovementPanel")).toBeVisible();
  await page.locator("#chart").evaluate(async (element, visibleDates) => {
    await globalThis.Plotly.relayout(element, {
      "xaxis.range[0]": `${visibleDates[0]}T00:00:00.000Z`,
      "xaxis.range[1]": `${visibleDates.at(-1)}T23:59:59.999Z`,
    });
  }, dates);
  await expect(page.locator("#coMovementPanel")).toContainText("SK하이닉스 5일");
  await expect(page.locator("#coMovementPanel")).toContainText("코스피 75%");
  await expect(page.locator("#coMovementPanel")).toContainText("코스닥 75%");
});

test("insider trade toggle draws DART buy and sell triangles for three years", async ({ page }) => {
  await installDataRoutes(page);
  await stubExternalRefreshes(page);
  await page.route("**/data/disclosures/005930.KS.json*", async (route) => {
    await route.fulfill({ json: {
      generated_at: "2026-07-15T00:00:00Z",
      source: "OpenDART",
      records: [
        {
          date: "2026-04-14",
          ticker: "005930.KS",
          name: "삼성전자",
          title: "유상증자 결정",
          url: "https://dart.fss.or.kr/example",
          source: "OpenDART",
        },
        {
          date: "2026-04-13",
          ticker: "005930.KS",
          name: "삼성전자",
          title: "전일 공시",
          url: "https://dart.fss.or.kr/previous",
          source: "OpenDART",
        },
      ],
    } });
  });
  let authorization = "";
  await page.addInitScript(() => {
    localStorage.setItem("thinkstock-dart-gateway-v1", JSON.stringify({ accessToken: "private" }));
    localStorage.setItem("thinkstock-v5", JSON.stringify({
      activeMonths: 36,
      hiddenSeries: ["leading_cycle", "^KS11", "^KQ11", "customer_deposit", "kospi_credit", "kosdaq_credit"],
      customStocks: [{ ticker: "005930.KS", name: "삼성전자", code: "005930", market: "KOSPI" }],
      hoverShowPopup: true,
      showDisclosures: true,
      showInsiderTrades: false,
    }));
  });
  await page.route("https://thinkstock-api.keg0320.workers.dev/api/dart/insider-trades?*", async (route) => {
    authorization = route.request().headers().authorization || "";
    const ticker = new URL(route.request().url()).searchParams.get("ticker") || "";
    const records = ticker === "000660.KS"
      ? [{
          ticker,
          date: "2026-04-14",
          side: "buy",
          reporter: "박임원",
          role: "대표이사",
          sharesChanged: 300,
          receiptNo: "20260414000456",
        }]
      : [
          {
            ticker: "005930.KS",
            date: "2026-04-14",
            side: "buy",
            reporter: "홍길동",
            role: "대표이사",
            sharesChanged: 1250,
            receiptNo: "20260114000123",
          },
          {
            ticker: "005930.KS",
            date: "2026-04-14",
            side: "sell",
            reporter: "김주주",
            role: "등기임원",
            sharesChanged: -500,
            receiptNo: "20260414000123",
          },
          {
            ticker: "005930.KS",
            date: "2026-04-13",
            side: "buy",
            reporter: "전일임원",
            role: "임원",
            sharesChanged: 100,
            receiptNo: "20260413000123",
          },
        ];
    await route.fulfill({
      status: 200,
      headers: { "access-control-allow-origin": "*", "content-type": "application/json" },
      body: JSON.stringify({
        ok: true,
        ticker,
        checkedFrom: "2023-08-03",
        records,
      }),
    });
  });
  await page.route("https://query2.finance.yahoo.com/v8/finance/chart/000660.KS**", async (route) => {
    await route.fulfill({ json: {
      chart: {
        result: [{
          meta: { gmtoffset: 0 },
          timestamp: [1768348800, 1776124800, 1783987200],
          indicators: { quote: [{ close: [180000, 210000, 240000] }] },
        }],
        error: null,
      },
    } });
  });

  await page.goto("/?e2e=1", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#chart .main-svg").first()).toBeVisible();
  await expect.poll(() => page.evaluate(() => (
    window.ThinkStockE2E?.getRefreshPhaseStats?.().criticalReady || 0
  ))).toBeGreaterThan(0);
  await expect.poll(() => page.locator("#chart").evaluate((element) => {
    const xRange = element?._fullLayout?.xaxis?.range?.map(Date.parse);
    const yRange = element?._fullLayout?.yaxis?.range?.map(Number);
    const stock = (element?.data || []).find((trace) => trace?.meta?.seriesKey === "005930.KS");
    if (!xRange?.every(Number.isFinite) || !yRange?.every(Number.isFinite) || !stock) return false;
    const lowX = Math.min(...xRange);
    const highX = Math.max(...xRange);
    const lowY = Math.min(...yRange);
    const highY = Math.max(...yRange);
    const visibleValues = (stock.x || []).flatMap((date, index) => {
      const time = Date.parse(date);
      const value = Number(stock.y?.[index]);
      return Number.isFinite(time) && Number.isFinite(value) && time >= lowX && time <= highX
        ? [value]
        : [];
    });
    return visibleValues.length > 0 && visibleValues.every((value) => value >= lowY && value <= highY);
  })).toBe(true);
  await expect(page.locator("#insiderTradeToggle")).toHaveAttribute("data-bound", "1");
  await expect.poll(() => page.locator("#chart").evaluate((element) => element._fullLayout?.hovermode)).toBe("x unified");
  await test.step("render and style disclosure and insider markers", async () => {
  await expect(page.locator("#insiderTradeToggle")).toHaveText("내부거래");
  await expect.poll(() => page.evaluate(() => window.ThinkStockE2E.getInsiderTradeState())).toMatchObject({
    enabled: false,
  });
  expect(await page.locator("#insiderTradeToggle").evaluate((element) => typeof element.onclick)).toBe("function");
  await page.locator("#insiderTradeToggle").click();
  await expect.poll(() => page.evaluate(() => window.ThinkStockE2E.getInsiderTradeState())).toMatchObject({
    enabled: true,
    rows: 3,
    loadedTickers: ["005930.KS"],
    pendingTickers: [],
    visibleTickers: ["005930.KS"],
    gatewayReady: true,
  });
  await expect.poll(() => page.locator("#chart").evaluate((element) => (
    (element.data || []).filter((trace) => trace?.meta?.isInsiderTradeTrace).map((trace) => ({
      side: trace.meta.insiderTradeSide,
      text: trace.text?.[0],
      color: trace.textfont?.color,
      yaxis: trace.yaxis,
      paired: trace.customdata?.[0]?.[2],
      dates: trace.x,
    }))
  ))).toEqual([
    { side: "buy", text: "▲", color: "#b91c1c", yaxis: "y", paired: true, dates: ["2026-04-14"] },
    { side: "sell", text: "▼", color: "#1d4ed8", yaxis: "y", paired: true, dates: ["2026-04-14"] },
  ]);
  await expect.poll(() => page.locator("#chart").evaluate((element) => {
    const html = (element.data || [])
      .filter((trace) => trace?.meta?.isGroupedHoverTrace)
      .flatMap((trace) => trace.text || [])
      .join("\n");
    return {
      disclosure: html.includes("공시"),
      buy: html.includes("내부자거래 : 매수"),
      sell: html.includes("내부자거래 : 매도"),
    };
  })).toEqual({
    disclosure: true,
    buy: true,
    sell: true,
  });
  const eventHoverTemplates = await page.locator("#chart").evaluate((element) => (
    (element.data || [])
      .filter((trace) => trace?.meta?.isDisclosureTrace || trace?.meta?.isInsiderTradeTrace)
      .flatMap((trace) => trace.hovertemplate || [])
  ));
  expect(eventHoverTemplates.every((template) => !template)).toBe(true);
  expect(await page.evaluate(() => {
    const hoverLayer = document.createElement("div");
    hoverLayer.className = "hoverlayer";
    const legendPoints = document.createElement("div");
    legendPoints.className = "legendpoints";
    hoverLayer.append(legendPoints);
    document.body.append(hoverLayer);
    const display = getComputedStyle(legendPoints).display;
    hoverLayer.remove();
    return display;
  })).toBe("none");
  await expect(page.locator("#insiderTradeToggle")).toHaveText("내부거래");
  await expect.poll(() => page.evaluate(() => {
    const resetStyle = getComputedStyle(document.getElementById("resetHandles"));
    const disclosureStyle = getComputedStyle(document.getElementById("disclosureToggle"));
    const insiderStyle = getComputedStyle(document.getElementById("insiderTradeToggle"));
    const reset = [resetStyle.backgroundColor, resetStyle.borderColor, resetStyle.color];
    const disclosure = [disclosureStyle.backgroundColor, disclosureStyle.borderColor, disclosureStyle.color];
    const insider = [insiderStyle.backgroundColor, insiderStyle.borderColor, insiderStyle.color];
    return disclosure.every((value, index) => value === reset[index])
      && insider.every((value, index) => value === reset[index]);
  })).toBe(true);
  await expect.poll(() => page.locator("#chart").evaluate((element) => {
    const disclosure = (element.data || []).find((trace) => trace?.meta?.isDisclosureTrace);
    const insiders = (element.data || []).filter((trace) => trace?.meta?.isInsiderTradeTrace);
    const stock = (element.data || []).find((trace) => trace?.meta?.seriesKey === "005930.KS");
    const stockYAt = (date) => {
      const index = stock?.x?.indexOf(date) ?? -1;
      return index >= 0 ? Number(stock.y[index]) : Number.NaN;
    };
    return {
      disclosureAxis: disclosure?.yaxis,
      disclosureDates: disclosure?.x,
      pairedDiamond: Number(insiders[0]?.y?.[0]) > Number(insiders[1]?.y?.[0]),
      disclosureAboveLine: (disclosure?.x || []).every((date, index) => (
        Number(disclosure.y[index]) > stockYAt(date)
      )),
      insiderBelowLine: insiders.every((trace) => (trace.x || []).every((date, index) => (
        Number(trace.y[index]) < stockYAt(date)
      ))),
    };
  })).toEqual({
    disclosureAxis: "y",
    disclosureDates: ["2026-04-14"],
    pairedDiamond: true,
    disclosureAboveLine: true,
    insiderBelowLine: true,
  });
  await expect.poll(() => page.locator("#chart").evaluate((element) => (
    [...element.querySelectorAll(".scatterlayer .textpoint text")]
      .filter((point) => ["▲", "▼"].includes(point.textContent?.trim())
        && ["rgb(185, 28, 28)", "rgb(29, 78, 216)"].includes(getComputedStyle(point).fill))
      .map((point) => getComputedStyle(point).display)
  ))).toEqual(["block", "block"]);

  const insiderBuyPoint = await page.locator("#chart").evaluate((element) => {
    const marker = [...element.querySelectorAll(".scatterlayer .textpoint text")]
      .find((point) => point.textContent?.trim() === "▲"
        && getComputedStyle(point).fill === "rgb(185, 28, 28)");
    const rect = marker?.getBoundingClientRect();
    return rect ? { x: (rect.left + rect.right) / 2, y: (rect.top + rect.bottom) / 2 } : null;
  });
  expect(insiderBuyPoint).not.toBeNull();
  await page.mouse.move(insiderBuyPoint.x, insiderBuyPoint.y);
  await expect.poll(() => page.locator("#chart").evaluate((element) => (
    element.classList.contains("is-event-marker-hovering")
  ))).toBe(true);
  await expect.poll(() => page.locator("#chart").evaluate((element) => {
    const marker = [...element.querySelectorAll(".scatterlayer .textpoint text")]
      .find((point) => point.textContent?.trim() === "▲"
        && getComputedStyle(point).fill === "rgb(185, 28, 28)");
    return Number.parseFloat(getComputedStyle(marker).fontSize);
  })).toBe(18);
  await page.mouse.click(insiderBuyPoint.x, insiderBuyPoint.y);
  await expect(page.locator("#chart .disclosure-popover")).toBeVisible();
  await expect(page.locator("#chart .disclosure-popover")).toContainText("내부자거래 : 매수");
  await expect(page.locator("#chart .disclosure-popover")).toContainText("홍길동");
  await page.locator("#chart .disclosure-popover").evaluate((node) => node.remove());
  await expect(page.locator("#chart .disclosure-popover")).toBeVisible();
  await expect(page.locator("#chart .disclosure-popover")).toContainText("홍길동");
  await page.locator("#chart .disclosure-popover button").click();
  await expect(page.locator("#chart .disclosure-popover")).toBeHidden();
  await page.mouse.move(1, 1);
  await expect.poll(() => page.locator("#chart").evaluate((element) => (
    element.classList.contains("is-event-marker-hovering")
  ))).toBe(false);

  const insiderSellPoint = await page.locator("#chart").evaluate((element) => {
    const marker = [...element.querySelectorAll(".scatterlayer .textpoint text")]
      .find((point) => point.textContent?.trim() === "▼"
        && getComputedStyle(point).fill === "rgb(29, 78, 216)");
    const rect = marker?.getBoundingClientRect();
    return rect ? { x: (rect.left + rect.right) / 2, y: (rect.top + rect.bottom) / 2 } : null;
  });
  expect(insiderSellPoint).not.toBeNull();
  await page.mouse.move(insiderSellPoint.x, insiderSellPoint.y);
  await expect.poll(() => page.locator("#chart").evaluate((element) => {
    const marker = [...element.querySelectorAll(".scatterlayer .textpoint text")]
      .find((point) => point.textContent?.trim() === "▼"
        && getComputedStyle(point).fill === "rgb(29, 78, 216)");
    return Number.parseFloat(getComputedStyle(marker).fontSize);
  })).toBe(18);
  await page.mouse.click(insiderSellPoint.x, insiderSellPoint.y);
  await expect(page.locator("#chart .disclosure-popover")).toBeVisible();
  await expect(page.locator("#chart .disclosure-popover")).toContainText("내부자거래 : 매도");
  await expect(page.locator("#chart .disclosure-popover")).toContainText("김주주");
  await page.locator("#chart .disclosure-popover button").click();
  await page.mouse.move(1, 1);
  });

  const readPairedMarkerGeometry = () => page.locator("#chart").evaluate((element) => {
    const points = [...element.querySelectorAll(".scatterlayer .textpoint text")]
      .filter((point) => ["▲", "▼"].includes(point.textContent?.trim()));
    const buy = points.find((point) => getComputedStyle(point).fill === "rgb(185, 28, 28)")
      ?.getBoundingClientRect();
    const sell = points.find((point) => getComputedStyle(point).fill === "rgb(29, 78, 216)")
      ?.getBoundingClientRect();
    if (!buy || !sell) return null;
    const stock = (element.data || []).find((trace) => trace?.meta?.seriesKey === "005930.KS");
    const stockIndex = stock?.x?.indexOf("2026-04-14") ?? -1;
    const axis = element?._fullLayout?.yaxis;
    const chartTop = element.getBoundingClientRect().top;
    const stockLineY = stockIndex >= 0 && axis
      ? chartTop + axis._offset + axis.l2p(Number(stock.y[stockIndex]))
      : Number.NaN;
    return {
      horizontallyAligned: Math.abs((buy.left + buy.right) - (sell.left + sell.right)) < 1,
      buyAboveSell: buy.top < sell.top,
      lineClearance: buy.top - stockLineY,
      centerSeparation: ((sell.top + sell.bottom) - (buy.top + buy.bottom)) / 2,
    };
  });
  const readEventMarkerClearances = () => page.locator("#chart").evaluate((element) => {
    const stock = (element.data || []).find((trace) => trace?.meta?.seriesKey === "005930.KS");
    const stockIndex = stock?.x?.indexOf("2026-04-14") ?? -1;
    const axis = element?._fullLayout?.yaxis;
    if (stockIndex < 0 || !axis || typeof axis.l2p !== "function") return [];
    const stockPixel = axis.l2p(Number(stock.y[stockIndex]));
    return (element.data || []).flatMap((trace) => {
      const kind = trace?.meta?.isDisclosureTrace
        ? "disclosure"
        : trace?.meta?.isInsiderTradeTrace
          ? `insider-${trace.meta.insiderTradeSide || ""}`
          : "";
      if (!kind) return [];
      return (trace.x || []).flatMap((date, index) => (
        String(date).slice(0, 10) === "2026-04-14" && Number.isFinite(Number(trace.y?.[index]))
          ? [{ kind, gap: Math.abs(axis.l2p(Number(trace.y[index])) - stockPixel) }]
          : []
      ));
    }).sort((left, right) => left.kind.localeCompare(right.kind));
  });
  const pairedMarkerGeometry = await test.step("align same-day insider markers around the stock line", async () => {
    const geometry = await readPairedMarkerGeometry();
    expect(geometry).toMatchObject({
      horizontallyAligned: true,
      buyAboveSell: true,
      lineClearance: expect.any(Number),
      centerSeparation: expect.any(Number),
    });
    expect(geometry.lineClearance).toBeGreaterThanOrEqual(1);
    expect(geometry.centerSeparation).toBeGreaterThan(0);
    expect(geometry.centerSeparation).toBeLessThanOrEqual(16);
    return geometry;
  });

  await test.step("keep handles and event markers synchronized during transforms", async () => {
    if (!await page.locator("#y-handles").count()) return;
    const chartResetButton = page.locator("#resetHandles");
    if (await chartResetButton.getAttribute("aria-pressed") === "true") {
      await chartResetButton.click();
    }
    await expect(chartResetButton).toHaveAttribute("aria-pressed", "false");
    const offsetHandle = page.locator('.y-handle-left[title="삼성전자 (위치)"]');
    const pairedScaleHandle = page.locator('.y-handle-right[title="삼성전자 (스케일)"]');
    await expect(offsetHandle).toBeVisible();
    await expect(pairedScaleHandle).toBeVisible();
    const offsetBefore = await waitForBoundingBox(offsetHandle);
    const handleTopsBefore = await page.locator("#y-handles").evaluate(() => ({
      offset: Number.parseFloat(document.querySelector('.y-handle-left[title="삼성전자 (위치)"]').style.top),
      scale: Number.parseFloat(document.querySelector('.y-handle-right[title="삼성전자 (스케일)"]').style.top),
    }));
  await offsetHandle.hover();
  await page.mouse.down();
  await page.mouse.move(
    offsetBefore.x + offsetBefore.width / 2,
    offsetBefore.y + offsetBefore.height / 2 + 30,
  );
  const handleTopsDuring = await page.locator("#y-handles").evaluate(() => ({
    offset: Number.parseFloat(document.querySelector('.y-handle-left[title="삼성전자 (위치)"]').style.top),
    scale: Number.parseFloat(document.querySelector('.y-handle-right[title="삼성전자 (스케일)"]').style.top),
  }));
  const offsetDelta = handleTopsDuring.offset - handleTopsBefore.offset;
  const scaleDelta = handleTopsDuring.scale - handleTopsBefore.scale;
  expect(Math.abs(offsetDelta - 30)).toBeLessThanOrEqual(1);
  expect(Math.abs(scaleDelta - offsetDelta)).toBeLessThanOrEqual(1);
  await page.mouse.up();

  const scaleHandle = page.locator('.y-handle-right[title="삼성전자 (스케일)"]');
  await expect(scaleHandle).toBeVisible();
  const scaleHandleBox = await waitForBoundingBox(scaleHandle);
  const scaleYRangeBefore = await page.locator("#chart").evaluate((element) => (
    [...element._fullLayout.yaxis.range]
  ));
  await scaleHandle.hover();
  await page.mouse.down();
  await expect(scaleHandle).toHaveClass(/dragging/);
  await expect(page.locator("#chart")).not.toHaveClass(/is-series-transform-marker-hidden/);
  await page.mouse.move(
    scaleHandleBox.x + scaleHandleBox.width / 2,
    scaleHandleBox.y + scaleHandleBox.height / 2 - 45,
    { steps: 3 },
  );
  await expect.poll(() => page.evaluate(() => (
    Object.keys(window.ThinkStockE2E.getSeriesTransforms().scales).length
  ))).toBeGreaterThan(0);
  await page.mouse.up();
  await expect(page.locator("#chart")).not.toHaveClass(/is-series-transform-marker-hidden/);
  await page.waitForTimeout(150);
  const scaleYRangeAfter = await page.locator("#chart").evaluate((element) => (
    [...element._fullLayout.yaxis.range]
  ));
  expect(scaleYRangeAfter[0]).toBeCloseTo(scaleYRangeBefore[0], 6);
  expect(scaleYRangeAfter[1]).toBeCloseTo(scaleYRangeBefore[1], 6);
  await expect.poll(async () => Math.abs(
    (await readPairedMarkerGeometry()).lineClearance - pairedMarkerGeometry.lineClearance,
  )).toBeLessThanOrEqual(2);
  await expect.poll(async () => Math.abs(
    (await readPairedMarkerGeometry()).centerSeparation - pairedMarkerGeometry.centerSeparation,
  )).toBeLessThanOrEqual(2);

  const transformsBeforeFit = await page.evaluate(() => window.ThinkStockE2E.getSeriesTransforms());
  expect(Object.keys(transformsBeforeFit.offsets).length).toBeGreaterThan(0);
  expect(Object.keys(transformsBeforeFit.scales).length).toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(() => window.ThinkStockE2E.getSeriesTransforms())).toEqual(
    transformsBeforeFit,
  );
  await expect.poll(async () => Math.abs(
    (await readPairedMarkerGeometry()).lineClearance - pairedMarkerGeometry.lineClearance,
  )).toBeLessThanOrEqual(2);
  await expect.poll(async () => Math.abs(
    (await readPairedMarkerGeometry()).centerSeparation - pairedMarkerGeometry.centerSeparation,
  )).toBeLessThanOrEqual(2);
  await waitForChartRenderIdle(page);
  const lineDragStart = await page.locator("#chart").evaluate((element) => {
    const trace = (element.data || []).find((item) => item?.meta?.seriesKey === "005930.KS");
    const xAxis = element?._fullLayout?.xaxis;
    const yAxis = element?._fullLayout?.yaxis;
    const rect = element.getBoundingClientRect();
    const validIndexes = Array.from(trace?.y || [], (value, index) => (
      Number.isFinite(Number(value)) ? index : -1
    )).filter((index) => index >= 0);
    const pointIndex = validIndexes[Math.floor(validIndexes.length / 2)] ?? -1;
    if (!trace || !xAxis || !yAxis || pointIndex < 0) return null;
    return {
      x: rect.left + xAxis._offset + xAxis.d2p(trace.x[pointIndex]),
      y: rect.top + yAxis._offset + yAxis.l2p(Number(trace.y[pointIndex])),
      ySpan: Math.abs(yAxis.range[1] - yAxis.range[0]),
    };
  });
  expect(lineDragStart).not.toBeNull();
  const lineHandleTopsBefore = await page.locator("#y-handles").evaluate(() => ({
    left: Number.parseFloat(document.querySelector('.y-handle-left[data-series-key="005930.KS"]').style.top),
    right: Number.parseFloat(document.querySelector('.y-handle-right[data-series-key="005930.KS"]').style.top),
  }));
  await page.mouse.move(lineDragStart.x, lineDragStart.y);
  await page.mouse.down();
  await page.mouse.move(lineDragStart.x, lineDragStart.y + 24);
  await expect.poll(async () => Object.keys(
    (await page.evaluate(() => window.ThinkStockE2E.getSeriesTransforms())).offsets,
  ).length).toBeGreaterThan(0);
  await expect.poll(() => page.locator("#y-handles").evaluate((container, before) => {
    const left = Number.parseFloat(container.querySelector('.y-handle-left[data-series-key="005930.KS"]').style.top);
    const right = Number.parseFloat(container.querySelector('.y-handle-right[data-series-key="005930.KS"]').style.top);
    return Math.abs((left - before.left) - 24) <= 1
      && Math.abs((right - before.right) - 24) <= 1;
  }, lineHandleTopsBefore)).toBe(true);
  const lineDragYSpan = await page.locator("#chart").evaluate((element) => (
    Math.abs(element._fullLayout.yaxis.range[1] - element._fullLayout.yaxis.range[0])
  ));
  expect(Math.abs(lineDragYSpan - lineDragStart.ySpan)).toBeLessThanOrEqual(0.01);
  await page.mouse.up();
  const transformsBeforeFinalFit = await page.evaluate(() => window.ThinkStockE2E.getSeriesTransforms());
  expect(Object.keys(transformsBeforeFinalFit.offsets).length).toBeGreaterThan(0);
  expect(Object.keys(transformsBeforeFinalFit.scales).length).toBeGreaterThan(0);
  await page.locator("#resetHandles").click();
  await expect(page.locator("#resetHandles")).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => page.evaluate(() => window.ThinkStockE2E.getSeriesTransforms())).toEqual(
    { offsets: {}, scales: {} },
  );
  await expect.poll(() => page.locator("#chart").evaluate((element) => (
    element._fullLayout.yaxis.autorange
  ))).toBe(false);
  const fittedRangeCoversVisibleLines = () => page.locator("#chart").evaluate((element) => {
    const xRange = element._fullLayout.xaxis.range.map((value) => Date.parse(value));
    const yRange = element._fullLayout.yaxis.range;
    const values = (element.data || [])
      .filter((trace) => trace?.meta?.seriesKey && trace.visible !== "legendonly")
      .flatMap((trace) => Array.from(trace.y || [], (value, index) => ({
        x: Date.parse(trace.x[index]),
        y: Number(value),
      })))
      .filter((point) => (
        Number.isFinite(point.x)
        && Number.isFinite(point.y)
        && point.x >= Math.min(...xRange)
        && point.x <= Math.max(...xRange)
      ));
    const minimum = Math.min(...values.map((point) => point.y));
    const maximum = Math.max(...values.map((point) => point.y));
    return yRange[0] < minimum && yRange[1] > maximum;
  });
  await expect.poll(fittedRangeCoversVisibleLines).toBe(true);
  const autoScaleMarkerGapsBefore = await readEventMarkerClearances();
  expect(autoScaleMarkerGapsBefore.map((item) => item.kind)).toEqual([
    "disclosure",
    "insider-buy",
    "insider-sell",
  ]);
  const expectMarkerGapsToMatch = (actual, expected) => {
    expect(actual.map((item) => item.kind)).toEqual(expected.map((item) => item.kind));
    actual.forEach((item, index) => {
      expect(Math.abs(item.gap - expected[index].gap)).toBeLessThanOrEqual(2);
    });
  };

  const autoScaleOffsetHandle = page.locator('.y-handle-left[title="삼성전자 (위치)"]');
  const autoScaleOffsetBox = await waitForBoundingBox(autoScaleOffsetHandle);
  await page.mouse.move(
    autoScaleOffsetBox.x + autoScaleOffsetBox.width / 2,
    autoScaleOffsetBox.y + autoScaleOffsetBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    autoScaleOffsetBox.x + autoScaleOffsetBox.width / 2,
    autoScaleOffsetBox.y + autoScaleOffsetBox.height / 2 + 28,
    { steps: 3 },
  );
  expectMarkerGapsToMatch(await readEventMarkerClearances(), autoScaleMarkerGapsBefore);
  await page.mouse.up();
  const autoScaleOffsetGapsAtRelease = await readEventMarkerClearances();
  expectMarkerGapsToMatch(autoScaleOffsetGapsAtRelease, autoScaleMarkerGapsBefore);
  await page.waitForTimeout(220);
  expectMarkerGapsToMatch(await readEventMarkerClearances(), autoScaleMarkerGapsBefore);

  const autoScaleLineStart = await page.locator("#chart").evaluate((element) => {
    const trace = (element.data || []).find((item) => item?.meta?.seriesKey === "005930.KS");
    const xAxis = element?._fullLayout?.xaxis;
    const yAxis = element?._fullLayout?.yaxis;
    const rect = element.getBoundingClientRect();
    const pointIndex = Math.max(0, Math.floor((trace?.x?.length || 1) / 2));
    if (!trace || !xAxis || !yAxis || !Number.isFinite(Number(trace.y?.[pointIndex]))) return null;
    return {
      x: rect.left + xAxis._offset + xAxis.d2p(trace.x[pointIndex]),
      y: rect.top + yAxis._offset + yAxis.l2p(Number(trace.y[pointIndex])),
    };
  });
  expect(autoScaleLineStart).not.toBeNull();
  const autoScaleLineGapsBefore = await readEventMarkerClearances();
  await page.mouse.move(autoScaleLineStart.x, autoScaleLineStart.y);
  await page.mouse.down();
  await page.mouse.move(autoScaleLineStart.x, autoScaleLineStart.y - 24, { steps: 3 });
  expectMarkerGapsToMatch(await readEventMarkerClearances(), autoScaleLineGapsBefore);
  await page.mouse.up();
  const autoScaleLineGapsAtRelease = await readEventMarkerClearances();
  expectMarkerGapsToMatch(autoScaleLineGapsAtRelease, autoScaleLineGapsBefore);
  await page.waitForTimeout(220);
  expectMarkerGapsToMatch(await readEventMarkerClearances(), autoScaleLineGapsBefore);

  const autoScaleHandle = page.locator('.y-handle-right[title="삼성전자 (스케일)"]');
  const autoScaleHandleBox = await waitForBoundingBox(autoScaleHandle);
  await page.mouse.move(
    autoScaleHandleBox.x + autoScaleHandleBox.width / 2,
    autoScaleHandleBox.y + autoScaleHandleBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    autoScaleHandleBox.x + autoScaleHandleBox.width / 2,
    autoScaleHandleBox.y + autoScaleHandleBox.height / 2 - 36,
    { steps: 3 },
  );
  const autoScaleMarkerGapsDuring = await readEventMarkerClearances();
  autoScaleMarkerGapsDuring.forEach((item, index) => {
    expect(Math.abs(item.gap - autoScaleMarkerGapsBefore[index].gap)).toBeLessThanOrEqual(2);
  });
  await page.mouse.up();
  const autoScaleMarkerGapsAtRelease = await readEventMarkerClearances();
  await page.waitForTimeout(220);
  const autoScaleMarkerGapsSettled = await readEventMarkerClearances();
  autoScaleMarkerGapsSettled.forEach((item, index) => {
    expect(Math.abs(item.gap - autoScaleMarkerGapsAtRelease[index].gap)).toBeLessThanOrEqual(2);
  });
  });

  await test.step("limit event hover to exact dates and update visible tickers", async () => {
  const moveNativeHoverToDate = async (date) => {
    const point = await page.locator("#chart").evaluate((element, targetDate) => {
      const xAxis = element?._fullLayout?.xaxis;
      const yAxis = element?._fullLayout?.yaxis;
      const rect = element.getBoundingClientRect();
      return {
        x: rect.left + Number(xAxis?._offset || 0) + xAxis.d2p(targetDate),
        y: rect.top + Number(yAxis?._offset || 0) + Number(yAxis?._length || 0) / 2,
      };
    }, date);
    await page.mouse.move(point.x - 4, point.y);
    await page.mouse.move(point.x, point.y);
  };
  const eventHoverInfo = () => page.locator("#chart").evaluate((element) => (
    (element.data || [])
      .filter((trace) => trace?.meta?.isInsiderTradeTrace || trace?.meta?.isDisclosureTrace)
      .map((trace) => trace.hoverinfo)
  ));
  await moveNativeHoverToDate("2026-01-14");
  await expect.poll(eventHoverInfo).toEqual(["skip", "skip", "skip"]);
  await moveNativeHoverToDate("2026-04-14");
  await expect.poll(eventHoverInfo).toEqual(["skip", "skip", "skip"]);
  await expect(page.locator("#chart .hoverlayer")).not.toContainText("▲");
  await expect(page.locator("#chart .hoverlayer")).not.toContainText("▼");
  expect(authorization).toBe("Bearer private");

  const insiderMarkerTickers = () => page.locator("#chart").evaluate((element) => (
    [...new Set((element.data || [])
      .filter((trace) => trace?.meta?.isInsiderTradeTrace)
      .flatMap((trace) => trace.customdata || [])
      .map((item) => item?.[0])
      .filter(Boolean))].sort()
  ));
  await expect.poll(insiderMarkerTickers).toEqual(["005930.KS"]);

  const zoomedRange = await page.locator("#chart").evaluate(async (element) => {
    await window.Plotly.relayout(element, { "xaxis.range": ["2026-01-14", "2026-04-14"] });
    return element._fullLayout.xaxis.range.map(Date.parse);
  });

  await page.locator("#stockSearchInput").fill("SK하이닉스");
  await page.locator(".stock-suggest-item").filter({ hasText: "SK하이닉스" }).click();
  await expect(page.locator('[data-series="000660.KS"]')).toBeVisible();
  await expect.poll(insiderMarkerTickers).toEqual(["000660.KS", "005930.KS"]);
  await expect.poll(() => page.locator("#chart").evaluate((element) => (
    (element.data || [])
      .filter((trace) => trace?.meta?.isInsiderTradeTrace)
      .flatMap((trace) => trace.customdata || [])
      .find((item) => item?.[0] === "000660.KS")?.[2]
  ))).toBe(false);
  await expect.poll(() => page.locator("#chart").evaluate((element) => (
    element._fullLayout.xaxis.range.map(Date.parse)
  ))).toEqual(zoomedRange);

  await page.locator('[data-series="005930.KS"]').click();
  await expect.poll(insiderMarkerTickers).toEqual(["000660.KS"]);
  await page.locator('[data-series="005930.KS"]').click();
  await expect.poll(insiderMarkerTickers).toEqual(["000660.KS", "005930.KS"]);

  await page.locator("#insiderTradeToggle").click();
  await expect(page.locator("#insiderTradeToggle")).toHaveText("내부거래");
  await expect.poll(() => page.locator("#chart").evaluate((element) => (
    (element.data || []).filter((trace) => trace?.meta?.isInsiderTradeTrace).length
  ))).toBe(0);
  });
});

test("AI analysis loads only on demand and reuses today's browser cache", async ({ page }) => {
  let analysisRequests = 0;
  let journalRecords = [];
  let releaseAnalysis;
  const analysisGate = new Promise((resolve) => { releaseAnalysis = resolve; });
  await stubExternalRefreshes(page);
  await page.addInitScript(() => {
    localStorage.setItem("thinkstock-dart-gateway-v1", JSON.stringify({ accessToken: "private" }));
    if (!localStorage.getItem("thinkstock-v5")) {
      localStorage.setItem("thinkstock-v5", JSON.stringify({
        showAiForecast: true,
        customStocks: [{
          ticker: "005930.KS",
          name: "삼성전자",
          code: "005930",
          market: "KOSPI",
        }],
      }));
    }
  });
  await page.route("https://thinkstock-api.keg0320.workers.dev/api/analysis**", async (route) => {
    analysisRequests += 1;
    const ticker = new URL(route.request().url()).searchParams.get("ticker");
    await analysisGate;
    await route.fulfill({
      status: 200,
      headers: { "access-control-allow-origin": "*", "content-type": "application/json" },
      body: JSON.stringify({
        ok: true,
        ticker,
        savedAt: Date.now(),
        analysisContractVersion: COMPANY_ANALYSIS_CONTRACT_VERSION,
        financialSummaryVersion: FINANCIAL_SUMMARY_VERSION,
        consensus: { ticker, targetPrice: 150000, opinion: 4.2, institutions: 6 },
        financials: [
          { ticker, period: "2024-12", frequency: "annual", revenue: 1000, operatingProfit: 80, eps: 3200 },
          { ticker, period: "2025-12", frequency: "annual", revenue: 1300, operatingProfit: 160, eps: 5200 },
          { ticker, period: "2025-12", frequency: "quarter", revenue: 300, operatingProfit: 32, eps: 1200 },
          { ticker, period: "2026-03", frequency: "quarter", revenue: 390, operatingProfit: 58, eps: 1800 },
        ],
        news: [{
          ticker,
          date: "2026-07-14",
          title: "대규모 공급계약 체결",
          source: "Naver Finance",
          url: `https://finance.naver.com/item/news_read.naver?code=${ticker.slice(0, 6)}&article_id=1`,
        }],
      }),
    });
  });
  await page.route("https://thinkstock-api.keg0320.workers.dev/api/forecast-journal**", async (route) => {
    if (route.request().method() === "POST") {
      journalRecords = route.request().postDataJSON()?.records || [];
    }
    await route.fulfill({
      status: 200,
      headers: { "access-control-allow-origin": "*", "content-type": "application/json" },
      body: JSON.stringify({ ok: true, ticker: "005930.KS", records: journalRecords }),
    });
  });

  await page.goto("/?e2e=1", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#chart .main-svg").first()).toBeVisible();
  await expect(page.locator("#aiForecastToggle")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#aiForecastToggle")).toBeEnabled();
  expect(analysisRequests).toBe(0);

  await page.locator("#aiForecastToggle").click();
  await expect.poll(() => analysisRequests).toBeGreaterThan(0);
  await expect(page.locator("#aiForecastToggle")).toHaveAttribute("aria-busy", "true");
  releaseAnalysis();
  await expect.poll(() => page.locator("#chart").evaluate((element) => (
    (element.data || []).filter((trace) => trace?.meta?.fundamentalsUsed).length
  )), { timeout: 30000 }).toBeGreaterThan(0);
  await expect.poll(() => page.locator("#chart").evaluate((element) => {
    const trace = (element.data || []).find((item) => item?.meta?.isAiForecastTrace);
    const rangeEnd = element?._fullLayout?.xaxis?.range?.[1];
    return Boolean(trace?.x?.at(-1) && rangeEnd && String(rangeEnd).slice(0, 10) >= trace.x.at(-1));
  })).toBe(true);
  await expect(page.locator("#aiForecastToggle")).toHaveAttribute("aria-busy", "false");
  await expect.poll(() => journalRecords.length).toBeGreaterThan(0);
  const savedForecast = journalRecords.find((record) => record.ticker === "005930.KS");
  expect(Object.keys(savedForecast?.horizons || {}).sort()).toEqual(["10", "126", "20", "5", "63"]);
  expect(Object.keys(savedForecast?.audit?.features || {}).length).toBeGreaterThan(50);
  expect(savedForecast?.audit?.sources?.internet_news_rows).toBe(1);
  expect(savedForecast?.horizons?.[126]?.attribution?.components).toBeTruthy();

  const firstRequestCount = analysisRequests;
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator("#aiForecastToggle")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#aiForecastToggle")).not.toHaveClass(/is-active/);
  await expect.poll(() => page.locator("#chart").evaluate((element) => (
    (element.data || []).filter((trace) => trace?.meta?.isAiForecastTrace).length
  ))).toBe(0);
  await expect(page.locator("#aiForecastToggle")).toBeEnabled();
  await page.locator("#aiForecastToggle").click();
  await expect(page.locator("#aiForecastToggle")).toHaveClass(/is-active/);
  await expect.poll(() => page.locator("#chart").evaluate((element) => (
    (element.data || []).filter((trace) => trace?.meta?.fundamentalsUsed).length
  )), { timeout: 30000 }).toBeGreaterThan(0);
  await page.waitForTimeout(300);
  expect(analysisRequests).toBe(firstRequestCount);
});

test("MACD automatically follows visible stock charts", async ({ page }) => {
  await stubExternalRefreshes(page);
  await page.addInitScript(() => {
    localStorage.setItem("thinkstock-v5", JSON.stringify({
      customStocks: [{
        ticker: "005930.KS",
        name: "삼성전자",
        code: "005930",
        market: "KOSPI",
      }],
    }));
  });
  await page.goto("/?e2e=1", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#chart .main-svg").first()).toBeVisible();
  await expect(page.locator("#chart-macd .main-svg").first()).toBeVisible();
  await expect.poll(() => page.locator("#chart-macd").evaluate((element) => (
    (element.data || []).filter((trace) => trace?.meta?.macdSeriesKey).length
  ))).toBeGreaterThan(0);

  const macdPresentation = await page.evaluate(() => {
    const mainTraces = document.getElementById("chart")?.data || [];
    const macdElement = document.getElementById("chart-macd");
    const macdTraces = (macdElement?.data || []).filter((trace) => trace?.meta?.macdSeriesKey);
    return {
      labels: macdTraces.map((trace) => trace.name),
      macroVisible: mainTraces.some((trace) => trace?.meta?.seriesKey === "^KS11"),
      onePixelLines: macdTraces.every((trace) => (
        trace?.type === "scatter"
        && trace?.mode === "lines"
        && trace?.line?.width === 1
      )),
      colorsMatch: macdTraces.every((trace) => {
        const mainTrace = mainTraces.find((candidate) => (
          candidate?.meta?.seriesKey === trace.meta.macdSeriesKey
        ));
        return mainTrace?.line?.color === trace?.line?.color;
      }),
      indicatorLabel: (macdElement?.layout?.annotations || []).some((annotation) => (
        annotation?.text === "MACD" && annotation?.xanchor === "left"
      )),
    };
  });
  expect(macdPresentation.macroVisible).toBe(true);
  expect(macdPresentation.labels).toContain("삼성전자");
  expect(macdPresentation.labels.every((label) => !label.endsWith(" MACD"))).toBe(true);
  expect(macdPresentation.onePixelLines).toBe(true);
  expect(macdPresentation.colorsMatch).toBe(true);
  expect(macdPresentation.indicatorLabel).toBe(true);

  const positions = await page.evaluate(() => {
    const shell = document.querySelector(".app-shell").getBoundingClientRect();
    const macd = document.getElementById("chart-macd").getBoundingClientRect();
    return {
      main: document.getElementById("chart").getBoundingClientRect().bottom,
      macdTop: macd.top,
      macdBottom: macd.bottom,
      macdInsideShell: macd.left >= shell.left && macd.right <= shell.right,
      adr: document.getElementById("chart-adr").getBoundingClientRect().top,
    };
  });
  expect(positions.macdTop).toBeGreaterThanOrEqual(positions.main);
  expect(positions.adr).toBeGreaterThanOrEqual(positions.macdBottom);
  expect(positions.macdInsideShell).toBe(true);

  await page.locator('.series-toggle-btn[data-series="005930.KS"]').click();
  await expect(page.locator("#chart-macd")).toBeHidden();
});

test("auxiliary charts retain available history while the viewport pans", async ({ page }) => {
  await stubExternalRefreshes(page);
  await page.addInitScript(() => {
    localStorage.setItem("thinkstock-v5", JSON.stringify({
      customStocks: [{
        ticker: "005930.KS",
        name: "삼성전자",
        code: "005930",
        market: "KOSPI",
      }],
    }));
  });
  await page.goto("/?e2e=1", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#chart .main-svg").first()).toBeVisible();
  await expect(page.locator("#chart-macd .main-svg").first()).toBeVisible();
  await expect(page.locator("#chart-adr .main-svg").first()).toBeVisible();

  const targetRange = await page.evaluate(() => {
    const main = document.getElementById("chart");
    const macd = document.getElementById("chart-macd");
    const auxiliary = document.getElementById("chart-adr");
    const initialStart = Date.parse(main?._fullLayout?.xaxis?.range?.[0]);
    const macdDates = (macd?.data || [])
      .filter((trace) => trace?.meta?.macdSeriesKey)
      .flatMap((trace) => trace.x || [])
      .map(Date.parse)
      .filter(Number.isFinite);
    const auxiliaryDates = (auxiliary?.data || [])
      .filter((trace) => trace?.meta?.auxiliarySeriesKey)
      .flatMap((trace) => trace.x || [])
      .map(Date.parse)
      .filter(Number.isFinite);
    const start = Math.max(Math.min(...macdDates), Math.min(...auxiliaryDates));
    const end = start + (180 * 24 * 60 * 60 * 1000);
    return {
      initialStart,
      start: new Date(start).toISOString(),
      end: new Date(end).toISOString(),
      isEarlier: end < initialStart,
    };
  });
  expect(targetRange.isEarlier).toBe(true);

  await page.locator("#chart").evaluate(async (element, range) => {
    await window.Plotly.relayout(element, { "xaxis.range": [range.start, range.end] });
  }, targetRange);
  await expect.poll(() => page.locator("#chart-macd").evaluate((element) => (
    Date.parse(element?._fullLayout?.xaxis?.range?.[0] || "")
  ))).toBe(Date.parse(targetRange.start));

  const visiblePoints = await page.evaluate((range) => {
    const count = (element, predicate) => (element?.data || [])
      .filter(predicate)
      .reduce((total, trace) => total + (trace.x || []).reduce((sum, date, index) => {
        const timestamp = Date.parse(date);
        return sum + (
          timestamp >= Date.parse(range.start)
          && timestamp <= Date.parse(range.end)
          && Number.isFinite(Number(trace.y?.[index]))
            ? 1
            : 0
        );
      }, 0), 0);
    return {
      macd: count(
        document.getElementById("chart-macd"),
        (trace) => Boolean(trace?.meta?.macdSeriesKey),
      ),
      auxiliary: count(
        document.getElementById("chart-adr"),
        (trace) => Boolean(trace?.meta?.auxiliarySeriesKey),
      ),
    };
  }, targetRange);
  expect(visiblePoints.macd).toBeGreaterThan(0);
  expect(visiblePoints.auxiliary).toBeGreaterThan(0);
});
