function createSettingsPanelRuntime(scope = globalThis, options = {}) {
    const {
      ADMIN_ACCESS_MASK,
      APP_BUILD_VERSION,
      APP_VERSION,
      NEWS_MOVING_AVERAGE_MIN_DAYS = 1,
      NEWS_MOVING_AVERAGE_MAX_DAYS = 20,
      CHART_RIGHT_PADDING_MIN_DAYS = 0,
      CHART_RIGHT_PADDING_MAX_DAYS = 30,
      STOCK_RESEARCH_UNIVERSE_MIN = 100,
      STOCK_RESEARCH_UNIVERSE_MAX = 1000,
      STOCK_RESEARCH_UNIVERSE_STEP = 100,
      apiPeriodsModule,
      releaseNotesModule,
      appCacheManager,
      controlStateView,
      authenticateAdminAccess,
      clearAdminAccessState,
      clearAllAppCaches,
      dartGatewaySettingsStore,
      deferredPerformanceDiagnostics,
      disclosureRefreshStore,
      getAdminAccessGranted,
      getBlockedStockCount,
      getCursorLineMode,
      getChartRightPaddingDays,
      getNewsSentimentMovingAverageDays,
      getStockResearchUniverseSize,
      getDartGatewayAccessToken,
      getRuntimeDiagnosticState,
      resetStoredAppState,
      setMessage,
      setCursorLineMode,
      setChartRightPaddingDays,
      setNewsSentimentMovingAverageDays,
      setStockResearchUniverseSize,
      syncApiOptionsButton,
      validateDartGatewayAccessToken,
    } = options;
    if (!scope.document || !apiPeriodsModule || !releaseNotesModule || !controlStateView
      || !appCacheManager || typeof getAdminAccessGranted !== "function") {
      throw new Error("settings panel runtime dependencies are incomplete");
    }

    const document = scope.document;
    const apiPeriods = apiPeriodsModule.DEFAULT_PERIODS;
    let openPanel = null;

    function renderApiPeriodRows(container, periods) {
      if (!container) return;
      const fragment = document.createDocumentFragment();
      periods.forEach((period) => {
        const row = document.createElement("div");
        const name = document.createElement("span");
        const dates = document.createElement("span");
        row.className = "api-period-row";
        row.setAttribute("role", "row");
        name.className = "api-period-name";
        name.setAttribute("role", "cell");
        name.textContent = period.name;
        dates.className = "api-period-dates";
        dates.setAttribute("role", "cell");
        dates.textContent = apiPeriodsModule.formatPeriodRange(period);
        row.append(name, dates);
        fragment.append(row);
      });
      container.replaceChildren(fragment);
    }

    function setup(msgEl) {
      const modal = document.getElementById("apiSettingsModal");
      const openBtn = document.getElementById("apiOptionsBtn");
      if (!modal || !openBtn) return;
    
      const closeBtn = document.getElementById("apiSettingsCloseBtn");
      const appCacheBtn = document.getElementById("appCacheBtn");
      const appCachePanel = document.getElementById("appCachePanel");
      const appCachePanelTotal = document.getElementById("appCachePanelTotal");
      const appCacheDeleteBtn = document.getElementById("appCacheDeleteBtn");
      const appCacheRows = document.getElementById("appCacheRows");
      const appCacheEmpty = document.getElementById("appCacheEmpty");
      const appCacheBrowserSize = document.getElementById("appCacheBrowserSize");
      const appCacheIndexedSize = document.getElementById("appCacheIndexedSize");
      const appCacheLocalSize = document.getElementById("appCacheLocalSize");
      const appCacheSessionSize = document.getElementById("appCacheSessionSize");
      const appStateResetBtn = document.getElementById("appStateResetBtn");
      const diagnosticsExportBtn = document.getElementById("diagnosticsExportBtn");
      const releaseNotesBtn = document.getElementById("releaseNotesBtn");
      const releaseNotesPanel = document.getElementById("releaseNotesPanel");
      const releaseNotesVersion = document.getElementById("releaseNotesVersion");
      const releaseNotesSize = document.getElementById("releaseNotesSize");
      const releaseNotesDate = document.getElementById("releaseNotesDate");
      const releaseNotesList = document.getElementById("releaseNotesList");
      const releaseNotesPosition = document.getElementById("releaseNotesPosition");
      const releaseNotesNewerBtn = document.getElementById("releaseNotesNewerBtn");
      const releaseNotesOlderBtn = document.getElementById("releaseNotesOlderBtn");
      const apiPeriodBtn = document.getElementById("apiPeriodBtn");
      const apiPeriodPanel = document.getElementById("apiPeriodPanel");
      const apiPeriodRows = document.getElementById("apiPeriodRows");
      const dartGatewayTokenInput = document.getElementById("dartGatewayTokenInput");
      const dartGatewayTokenSaveBtn = document.getElementById("dartGatewayTokenSaveBtn");
      const dartGatewayTokenStatus = document.getElementById("dartGatewayTokenStatus");
      const adminAccessCodeInput = document.getElementById("adminAccessCodeInput");
      const adminAccessCodeBtn = document.getElementById("adminAccessCodeBtn");
      const adminAccessStatus = document.getElementById("adminAccessStatus");
      const cursorLineModeButtons = [...modal.querySelectorAll(
        ".cursor-line-mode-btn[data-chart-cursor-mode]",
      )];
      const chartRightPaddingDecrease = document.getElementById("chartRightPaddingDecrease");
      const chartRightPaddingIncrease = document.getElementById("chartRightPaddingIncrease");
      const chartRightPaddingValue = document.getElementById("chartRightPaddingValue");
      const newsMovingAverageDecrease = document.getElementById("newsSentimentMovingAverageDecrease");
      const newsMovingAverageIncrease = document.getElementById("newsSentimentMovingAverageIncrease");
      const newsMovingAverageValue = document.getElementById("newsSentimentMovingAverageValue");
      const stockResearchUniverseDecrease = document.getElementById("stockResearchUniverseDecrease");
      const stockResearchUniverseIncrease = document.getElementById("stockResearchUniverseIncrease");
      const stockResearchUniverseValue = document.getElementById("stockResearchUniverseValue");
      const releaseNotesNavigator = releaseNotesModule.createReleaseNotesNavigator();

      // Chart drag handlers also listen on window. Keep every settings gesture inside the modal.
      ["pointerdown", "pointermove", "pointerup", "pointercancel", "click", "dblclick", "wheel"]
        .forEach((eventName) => modal.addEventListener(eventName, (event) => {
          event.stopPropagation();
        }));

      const setInformationPanelState = (button, panel, visible) => {
        if (panel) panel.hidden = !visible;
        controlStateView.syncControl(button, { pressed: visible, expanded: visible });
      };
      const closeInformationPanels = () => {
        setInformationPanelState(releaseNotesBtn, releaseNotesPanel, false);
        setInformationPanelState(apiPeriodBtn, apiPeriodPanel, false);
        setInformationPanelState(appCacheBtn, appCachePanel, false);
      };
      renderApiPeriodRows(
        apiPeriodRows,
        apiPeriodsModule.compactPeriodsForDisplay(apiPeriods),
      );
    
      const setAccessStatus = (element, message = "", isError = false) => {
        if (!element) return;
        element.textContent = message;
        element.hidden = !message;
        element.classList.toggle("is-error", Boolean(message) && isError);
      };
    
      const syncAdminAccessUi = () => {
        if (adminAccessStatus) {
          adminAccessStatus.textContent = getAdminAccessGranted()
            ? "관리자 모드: 종목탐구·공시·내부거래·동행율·신호·AI 기능을 사용할 수 있습니다."
            : "일반 모드: 종목탐구·공시·내부거래·동행율·신호·AI 기능이 잠겨 있습니다.";
          adminAccessStatus.classList.toggle("is-active", getAdminAccessGranted());
          adminAccessStatus.classList.remove("is-error");
          adminAccessStatus.hidden = false;
        }
        if (adminAccessCodeInput && getAdminAccessGranted()) {
          adminAccessCodeInput.value = ADMIN_ACCESS_MASK;
        }
        if (adminAccessCodeBtn) adminAccessCodeBtn.textContent = getAdminAccessGranted() ? "해제" : "인증";
      };
      const syncCursorLineModeUi = () => {
        const activeMode = typeof getCursorLineMode === "function"
          ? getCursorLineMode()
          : "vertical";
        controlStateView.syncChoiceControls(cursorLineModeButtons, activeMode, {
          readValue: (button) => button.dataset.chartCursorMode,
        });
      };
      const syncChartRightPaddingUi = () => {
        const days = Math.min(
          CHART_RIGHT_PADDING_MAX_DAYS,
          Math.max(
            CHART_RIGHT_PADDING_MIN_DAYS,
            Math.round(Number(getChartRightPaddingDays?.()) || 0),
          ),
        );
        if (chartRightPaddingValue) {
          chartRightPaddingValue.value = String(days);
          chartRightPaddingValue.textContent = String(days);
        }
        if (chartRightPaddingDecrease) {
          chartRightPaddingDecrease.disabled = days <= CHART_RIGHT_PADDING_MIN_DAYS;
        }
        if (chartRightPaddingIncrease) {
          chartRightPaddingIncrease.disabled = days >= CHART_RIGHT_PADDING_MAX_DAYS;
        }
      };
      const syncNewsMovingAverageUi = () => {
        const days = Math.min(
          NEWS_MOVING_AVERAGE_MAX_DAYS,
          Math.max(
            NEWS_MOVING_AVERAGE_MIN_DAYS,
            Math.round(Number(getNewsSentimentMovingAverageDays?.()) || NEWS_MOVING_AVERAGE_MIN_DAYS),
          ),
        );
        if (newsMovingAverageValue) {
          newsMovingAverageValue.value = String(days);
          newsMovingAverageValue.textContent = String(days);
        }
        if (newsMovingAverageDecrease) {
          newsMovingAverageDecrease.disabled = days <= NEWS_MOVING_AVERAGE_MIN_DAYS;
        }
        if (newsMovingAverageIncrease) {
          newsMovingAverageIncrease.disabled = days >= NEWS_MOVING_AVERAGE_MAX_DAYS;
        }
      };
      const syncStockResearchUniverseUi = () => {
        const size = Math.min(
          STOCK_RESEARCH_UNIVERSE_MAX,
          Math.max(
            STOCK_RESEARCH_UNIVERSE_MIN,
            Math.round(Number(getStockResearchUniverseSize?.()) || STOCK_RESEARCH_UNIVERSE_MIN),
          ),
        );
        if (stockResearchUniverseValue) {
          stockResearchUniverseValue.value = String(size);
          stockResearchUniverseValue.textContent = String(size);
        }
        if (stockResearchUniverseDecrease) {
          stockResearchUniverseDecrease.disabled = size <= STOCK_RESEARCH_UNIVERSE_MIN;
        }
        if (stockResearchUniverseIncrease) {
          stockResearchUniverseIncrease.disabled = size >= STOCK_RESEARCH_UNIVERSE_MAX;
        }
      };
    
      let cacheMeasureSequence = 0;
      let latestAppCacheSummary = null;
      let appCacheMeasurePromise = null;
      const measureAppCache = () => {
        if (!appCacheMeasurePromise) {
          appCacheMeasurePromise = appCacheManager.measure()
            .then((summary) => {
              latestAppCacheSummary = summary;
              return summary;
            })
            .finally(() => { appCacheMeasurePromise = null; });
        }
        return appCacheMeasurePromise;
      };
      const renderAppCacheSummary = (summary) => {
        if (!summary) return;
        const totalText = appCacheManager.formatBytes(summary.totalBytes);
        const hasCache = summary.totalBytes > 0;
        const heading = hasCache ? `캐시 ${totalText}` : "캐시 없음";
        const renderCategory = (element, bytes) => {
          if (!element) return;
          const size = Math.max(0, Number(bytes) || 0);
          element.textContent = appCacheManager.formatBytes(size);
          const row = element.closest(".app-cache-row");
          if (row) row.hidden = size <= 0;
        };
        appCacheBtn.textContent = heading;
        appCacheBtn.disabled = false;
        appCacheBtn.title = "캐시 종류별 용량 보기";
        if (appCachePanelTotal) appCachePanelTotal.textContent = heading;
        renderCategory(appCacheBrowserSize, summary.browserCacheBytes);
        renderCategory(appCacheIndexedSize, summary.indexedBytes);
        renderCategory(appCacheLocalSize, summary.localBytes);
        renderCategory(appCacheSessionSize, summary.sessionBytes);
        if (appCacheRows) appCacheRows.hidden = !hasCache;
        if (appCacheEmpty) appCacheEmpty.hidden = hasCache;
        if (appCacheDeleteBtn) appCacheDeleteBtn.disabled = !hasCache;
      };
      const syncAppCacheUi = async () => {
        if (!appCacheBtn) return null;
        const sequence = ++cacheMeasureSequence;
        appCacheBtn.disabled = true;
        appCacheBtn.setAttribute("aria-busy", "true");
        appCacheBtn.textContent = "캐시 계산 중";
        try {
          const summary = await measureAppCache();
          if (sequence !== cacheMeasureSequence) return summary;
          renderAppCacheSummary(summary);
          return summary;
        } catch (error) {
          if (sequence !== cacheMeasureSequence) return null;
          latestAppCacheSummary = null;
          appCacheBtn.disabled = false;
          appCacheBtn.textContent = "캐시 확인 실패";
          appCacheBtn.title = error?.message || String(error);
          if (appCachePanelTotal) appCachePanelTotal.textContent = "캐시 확인 실패";
          if (appCacheDeleteBtn) appCacheDeleteBtn.disabled = true;
          return null;
        } finally {
          if (sequence === cacheMeasureSequence) appCacheBtn.removeAttribute("aria-busy");
        }
      };

      const captureDiagnosticsLog = async (cacheSummary = latestAppCacheSummary) => {
        try {
          const performanceDiagnostics = await deferredPerformanceDiagnostics.ensure();
          await performanceDiagnostics.capture({
            appVersion: APP_VERSION,
            buildVersion: APP_BUILD_VERSION,
            reason: "settings-open",
            appState: {
              ...(typeof getRuntimeDiagnosticState === "function"
                ? getRuntimeDiagnosticState()
                : {}),
              cacheBytes: Number(cacheSummary?.totalBytes) || 0,
              blockedStockCount: getBlockedStockCount(),
            },
          });
        } catch (_) {
          // Diagnostics are best-effort and never block the settings panel.
        }
      };

      const renderReleaseNotes = (state = releaseNotesNavigator.current()) => {
        const release = state?.release;
        if (!releaseNotesPanel || !releaseNotesVersion || !releaseNotesList || !release) return;
        releaseNotesVersion.textContent = `v${release.version}`;
        if (releaseNotesSize) {
          const sourceBytes = Math.max(0, Number(releaseNotesModule.SOURCE_BYTES) || 0);
          releaseNotesSize.textContent = sourceBytes > 0 ? appCacheManager.formatBytes(sourceBytes) : "";
          releaseNotesSize.hidden = sourceBytes <= 0;
        }
        if (releaseNotesDate) {
          releaseNotesDate.textContent = String(release.date || "");
          releaseNotesDate.hidden = !release.date;
        }
        const items = (Array.isArray(release.items) ? release.items : []).slice(0, 10);
        const twoColumns = items.length > 5;
        const splitIndex = twoColumns ? 5 : items.length;
        const fragment = document.createDocumentFragment();
        items.forEach((item, index) => {
          const row = document.createElement("li");
          row.textContent = item;
          if (twoColumns) {
            row.title = item;
            const inSecondColumn = index >= splitIndex;
            row.style.gridColumn = inSecondColumn ? "2" : "1";
            row.style.gridRow = String(inSecondColumn ? index - splitIndex + 1 : index + 1);
          }
          fragment.append(row);
        });
        releaseNotesList.classList.toggle("is-two-column", twoColumns);
        releaseNotesList.replaceChildren(fragment);
        if (releaseNotesPosition) releaseNotesPosition.textContent = `${state.index + 1} / ${state.total}`;
        if (releaseNotesNewerBtn) releaseNotesNewerBtn.disabled = !state.hasNewer;
        if (releaseNotesOlderBtn) releaseNotesOlderBtn.disabled = !state.hasOlder;
      };
    
      const close = () => {
        closeInformationPanels();
        modal.hidden = true;
      };
      const open = () => {
        if (dartGatewayTokenInput) dartGatewayTokenInput.value = getDartGatewayAccessToken();
        setAccessStatus(dartGatewayTokenStatus);
        if (adminAccessCodeInput) adminAccessCodeInput.value = "";
        syncAdminAccessUi();
        syncChartRightPaddingUi();
        syncCursorLineModeUi();
        syncNewsMovingAverageUi();
        syncStockResearchUniverseUi();
        renderReleaseNotes(releaseNotesNavigator.reset());
        modal.hidden = false;
        syncAppCacheUi().then(captureDiagnosticsLog);
      };
      openPanel = open;
    
      if (openBtn.dataset.bound === "1") {
        syncApiOptionsButton();
        return;
      }
      openBtn.dataset.bound = "1";
    
      openBtn.addEventListener("click", open);
      cursorLineModeButtons.forEach((button) => {
        button.addEventListener("click", () => {
          if (typeof setCursorLineMode !== "function") return;
          setCursorLineMode(button.dataset.chartCursorMode);
          syncCursorLineModeUi();
        });
      });
      chartRightPaddingDecrease?.addEventListener("click", () => {
        if (typeof setChartRightPaddingDays !== "function") return;
        setChartRightPaddingDays(Number(getChartRightPaddingDays?.()) - 1);
        syncChartRightPaddingUi();
      });
      chartRightPaddingIncrease?.addEventListener("click", () => {
        if (typeof setChartRightPaddingDays !== "function") return;
        setChartRightPaddingDays(Number(getChartRightPaddingDays?.()) + 1);
        syncChartRightPaddingUi();
      });
      newsMovingAverageDecrease?.addEventListener("click", () => {
        if (typeof setNewsSentimentMovingAverageDays !== "function") return;
        setNewsSentimentMovingAverageDays(Number(getNewsSentimentMovingAverageDays?.()) - 1);
        syncNewsMovingAverageUi();
      });
      newsMovingAverageIncrease?.addEventListener("click", () => {
        if (typeof setNewsSentimentMovingAverageDays !== "function") return;
        setNewsSentimentMovingAverageDays(Number(getNewsSentimentMovingAverageDays?.()) + 1);
        syncNewsMovingAverageUi();
      });
      stockResearchUniverseDecrease?.addEventListener("click", () => {
        if (typeof setStockResearchUniverseSize !== "function") return;
        setStockResearchUniverseSize(
          Number(getStockResearchUniverseSize?.()) - STOCK_RESEARCH_UNIVERSE_STEP,
        );
        syncStockResearchUniverseUi();
      });
      stockResearchUniverseIncrease?.addEventListener("click", () => {
        if (typeof setStockResearchUniverseSize !== "function") return;
        setStockResearchUniverseSize(
          Number(getStockResearchUniverseSize?.()) + STOCK_RESEARCH_UNIVERSE_STEP,
        );
        syncStockResearchUniverseUi();
      });
      closeBtn?.addEventListener("click", close);
      modal.querySelectorAll("[data-api-close='1']").forEach((node) => {
        node.addEventListener("click", close);
      });
      document.addEventListener("keydown", (event) => {
        if (event.key !== "Escape") return;
        if (!modal.hidden) close();
      });
    
      appCacheBtn?.addEventListener("click", async () => {
        const show = Boolean(appCachePanel?.hidden);
        closeInformationPanels();
        setInformationPanelState(appCacheBtn, appCachePanel, show);
        if (show && latestAppCacheSummary) renderAppCacheSummary(latestAppCacheSummary);
        else if (show) await syncAppCacheUi();
      });
      appCacheDeleteBtn?.addEventListener("click", async () => {
        if (appCacheDeleteBtn.getAttribute("aria-busy") === "true") return;
        appCacheDeleteBtn.disabled = true;
        appCacheDeleteBtn.setAttribute("aria-busy", "true");
        appCacheDeleteBtn.textContent = "삭제 중";
        try {
          await clearAllAppCaches();
          latestAppCacheSummary = null;
          await syncAppCacheUi();
          setMessage(msgEl, ["ThinkStock 캐시를 초기화했습니다."]);
        } catch (err) {
          await syncAppCacheUi();
          setMessage(msgEl, `캐시 초기화 오류: ${err.message}`, true);
        } finally {
          appCacheDeleteBtn.removeAttribute("aria-busy");
          appCacheDeleteBtn.textContent = "캐시삭제";
        }
      });
      appStateResetBtn?.addEventListener("click", () => {
        try {
          resetStoredAppState();
          close();
          scope.location?.reload?.();
        } catch (err) {
          setMessage(msgEl, `상태 초기화 오류: ${err.message}`, true);
        }
      });
      diagnosticsExportBtn?.addEventListener("click", async () => {
        if (diagnosticsExportBtn.getAttribute("aria-busy") === "true") return;
        diagnosticsExportBtn.setAttribute("aria-busy", "true");
        diagnosticsExportBtn.disabled = true;
        diagnosticsExportBtn.textContent = "준비 중";
        try {
          const [performanceDiagnostics, cacheSummary] = await Promise.all([
            deferredPerformanceDiagnostics.ensure(),
            measureAppCache().catch(() => latestAppCacheSummary),
          ]);
          const payload = await performanceDiagnostics.exportSnapshot({
            appVersion: APP_VERSION,
            buildVersion: APP_BUILD_VERSION,
            appState: {
              ...(typeof getRuntimeDiagnosticState === "function"
                ? getRuntimeDiagnosticState()
                : {}),
              cacheBytes: Number(cacheSummary?.totalBytes) || 0,
              blockedStockCount: getBlockedStockCount(),
            },
          });
          const stamp = new Date().toISOString().replace(/[:.]/g, "-");
          const downloaded = performanceDiagnostics.downloadSnapshot(
            payload,
            `thinkstock-diagnostics-${stamp}.json`,
          );
          setMessage(msgEl, [downloaded
            ? "ThinkStock 진단 파일을 저장했습니다."
            : "이 브라우저에서는 진단 파일 저장을 지원하지 않습니다."], !downloaded);
        } catch (error) {
          setMessage(msgEl, `진단 파일 생성 오류: ${error.message}`, true);
        } finally {
          diagnosticsExportBtn.removeAttribute("aria-busy");
          diagnosticsExportBtn.disabled = false;
          diagnosticsExportBtn.textContent = "진단내보내기";
        }
      });
      releaseNotesBtn?.addEventListener("click", () => {
        if (releaseNotesPanel && !releaseNotesPanel.hidden) {
          setInformationPanelState(releaseNotesBtn, releaseNotesPanel, false);
          return;
        }
        setInformationPanelState(apiPeriodBtn, apiPeriodPanel, false);
        setInformationPanelState(appCacheBtn, appCachePanel, false);
        setInformationPanelState(releaseNotesBtn, releaseNotesPanel, true);
        renderReleaseNotes();
      });
      apiPeriodBtn?.addEventListener("click", () => {
        const show = Boolean(apiPeriodPanel?.hidden);
        setInformationPanelState(releaseNotesBtn, releaseNotesPanel, false);
        setInformationPanelState(appCacheBtn, appCachePanel, false);
        setInformationPanelState(apiPeriodBtn, apiPeriodPanel, show);
      });
      releaseNotesNewerBtn?.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        renderReleaseNotes(releaseNotesNavigator.newer());
      });
      releaseNotesOlderBtn?.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        renderReleaseNotes(releaseNotesNavigator.older());
      });
      adminAccessCodeBtn?.addEventListener("click", async () => {
        if (getAdminAccessGranted()) {
          clearAdminAccessState();
          if (adminAccessCodeInput) adminAccessCodeInput.value = "";
          syncAdminAccessUi();
          setMessage(msgEl, ["관리자 모드를 해제하고 일반 모드로 전환했습니다."]);
          return;
        }
        const accessCode = String(adminAccessCodeInput?.value || "").trim();
        if (!/^\d{10}$/.test(accessCode)) {
          setAccessStatus(adminAccessStatus, "접속코드가 틀렸습니다.", true);
          return;
        }
        adminAccessCodeBtn.setAttribute("disabled", "");
        try {
          const result = await authenticateAdminAccess(accessCode);
          if (!result?.ok) {
            setAccessStatus(adminAccessStatus, "접속코드가 틀렸습니다.", true);
            return;
          }
          if (adminAccessCodeInput) adminAccessCodeInput.value = "";
          syncAdminAccessUi();
          setMessage(msgEl, ["관리자 모드가 활성화되었습니다."]);
        } catch (_) {
          setAccessStatus(adminAccessStatus, "접속코드가 틀렸습니다.", true);
        } finally {
          adminAccessCodeBtn.removeAttribute("disabled");
        }
      });
      adminAccessCodeInput?.addEventListener("keydown", (event) => {
        if (event.key === "Enter") adminAccessCodeBtn?.click();
      });
      adminAccessCodeInput?.addEventListener("input", () => {
        if (adminAccessStatus?.classList.contains("is-error")) syncAdminAccessUi();
      });
      dartGatewayTokenInput?.addEventListener("input", () => {
        setAccessStatus(dartGatewayTokenStatus);
      });
      dartGatewayTokenSaveBtn?.addEventListener("click", async () => {
        const accessToken = String(dartGatewayTokenInput?.value || "").trim();
        if (!accessToken) {
          try {
            dartGatewaySettingsStore.clear();
            disclosureRefreshStore.remove();
          } catch (_) {}
          syncApiOptionsButton();
          close();
          setMessage(msgEl, ["Think Stock 접속 코드를 이 기기에서 지웠습니다."]);
          return;
        }
        dartGatewayTokenSaveBtn.setAttribute("disabled", "");
        setAccessStatus(dartGatewayTokenStatus, "Think Stock 접속 코드를 확인하고 있습니다.");
        setMessage(msgEl, ["Think Stock 접속 코드를 확인하고 있습니다."]);
        try {
          const validation = await validateDartGatewayAccessToken(accessToken);
          if (!validation.ok) {
            setAccessStatus(dartGatewayTokenStatus, "접속코드가 틀렸습니다.", true);
            return;
          }
          dartGatewaySettingsStore.save({ accessToken });
          disclosureRefreshStore.remove();
          if (dartGatewayTokenInput) dartGatewayTokenInput.value = accessToken;
          syncApiOptionsButton();
          close();
          setMessage(msgEl, ["확인된 Think Stock 접속 코드를 이 기기에 저장했습니다."]);
        } catch (error) {
          setAccessStatus(
            dartGatewayTokenStatus,
            `Think Stock 접속 코드를 확인하지 못했습니다: ${error.message}`,
            true,
          );
          setMessage(msgEl, [`접속 코드를 확인하지 못했습니다: ${error.message}`], true);
        } finally {
          dartGatewayTokenSaveBtn.removeAttribute("disabled");
        }
      });
    
      syncApiOptionsButton();
      syncAdminAccessUi();
      syncCursorLineModeUi();
      syncNewsMovingAverageUi();
      syncStockResearchUniverseUi();
    }

    return Object.freeze({
      open: () => openPanel?.(),
      setup,
    });
  }

export { createSettingsPanelRuntime };
