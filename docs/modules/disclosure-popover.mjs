"use strict";

import { createScrollAffordance } from "./control-state-view.mjs";

  function buildPopoverHtml(group, options = {}) {
    const escapeHtml = options.escapeHtml || ((value) => String(value || ""));
    const fallbackName = options.fallbackName || (() => "");
    const closeLabel = escapeHtml(options.closeLabel || "공시 닫기");
    const items = (group?.events || []).map((event, eventIndex) => {
      const title = escapeHtml(event.title);
      const caption = String(event.caption || "").trim();
      const tone = ["insider-buy", "insider-sell"].includes(event.tone) ? event.tone : "";
      const toneAttribute = tone ? ` data-event-tone="${tone}"` : "";
      const captionHtml = caption
        ? `<span class="disclosure-event-caption">${escapeHtml(caption)}</span>`
        : "";
      const linkAction = String(event.linkAction || "").trim();
      const actionAttributes = linkAction
        ? ` data-link-action="${escapeHtml(linkAction)}" data-event-index="${eventIndex}"`
        : "";
      const titleHtml = event.url
        ? `<a class="disclosure-title-link" href="${escapeHtml(event.url)}" target="_blank" rel="noopener"${actionAttributes}>${title}</a>`
        : `<strong>${title}</strong>`;
      return `<li${toneAttribute}>${captionHtml}${titleHtml}</li>`;
    }).join("");
    return `
      <div class="disclosure-popover-head">
        <div>
          <b>${escapeHtml(group?.name || fallbackName(group))}</b>
          <span>${escapeHtml(group?.plotDate || "")}</span>
        </div>
        <button type="button" data-popover-close aria-label="${closeLabel}">&times;</button>
      </div>
      <ul>${items}</ul>
    `;
  }

  const DESTRUCTIVE_SUMMARY_ACTIONS = new Set(["차단", "제거"]);

  function summaryActionClass(actionLabel) {
    return DESTRUCTIVE_SUMMARY_ACTIONS.has(String(actionLabel || "").trim())
      ? " chart-hover-summary-action is-destructive"
      : " chart-hover-summary-action";
  }

  function buildHoverSummaryHtml(group, options = {}) {
    const escapeHtml = options.escapeHtml || ((value) => String(value || ""));
    const items = (group?.events || [])
      .map((event, eventIndex) => {
        const title = String(event?.title || "");
        const fullTitle = String(event?.fullTitle || title);
        const actionLabel = String(event?.actionLabel || "").trim();
        const action = actionLabel
          ? `<button class="${summaryActionClass(actionLabel).trim()}" type="button" data-popover-event-action data-event-index="${eventIndex}" aria-label="${escapeHtml(fullTitle)} ${escapeHtml(actionLabel)}">${escapeHtml(actionLabel)}</button>`
          : "";
        return `<span class="chart-hover-summary-row"><span class="chart-hover-summary-title" title="${escapeHtml(fullTitle)}">${escapeHtml(title)}</span>${action}</span>`;
      })
      .join("");
    return `<div class="chart-hover-summary-lines">${items}</div>`;
  }

  function createDisclosurePopover(scope = globalThis, options = {}) {
    const chartId = String(options.chartId || "chart");
    const nodeClassName = String(options.className || "disclosure-popover");
    const nodeSelector = String(options.nodeSelector || `.${nodeClassName.split(/\s+/)[0]}`);
    const renderHtml = typeof options.renderHtml === "function"
      ? options.renderHtml
      : (group) => buildPopoverHtml(group, options);
    let node = null;
    let observedChart = null;
    let chartObserver = null;
    let outsidePointerHandler = null;
    const scrollAffordance = createScrollAffordance(scope);

    function detachScrollIndicators() {
      scrollAffordance.detach();
    }

    function syncScrollIndicators() {
      scrollAffordance.syncNow();
    }

    function bindScrollIndicators() {
      detachScrollIndicators();
      const selector = String(options.scrollIndicatorSelector || "").trim();
      if (!selector || !node) return;
      const scrollContainer = node.querySelector(selector);
      if (!scrollContainer) return;
      scrollAffordance.bind(scrollContainer, node);
    }

    function watchChart(chart) {
      if (!chart || observedChart === chart) return;
      chartObserver?.disconnect();
      observedChart = chart;
      if (typeof scope.MutationObserver !== "function") return;
      chartObserver = new scope.MutationObserver(() => {
        if (!node || node.hidden || node.parentNode === chart) return;
        chart.appendChild(node);
      });
      chartObserver.observe(chart, { childList: true });
    }

    function hide() {
      if (!node || node.hidden) return;
      node.hidden = true;
      scrollAffordance.clearState();
      options.onVisibilityChange?.(false);
    }

    function ensure() {
      const chart = scope.document?.getElementById(chartId);
      if (!chart) return null;
      watchChart(chart);
      const attachedNode = chart.querySelector(nodeSelector);
      if (attachedNode) {
        node = attachedNode;
        return node;
      }
      // Plotly may replace chart children during a structural render. Reattach
      // the existing popover instead of updating a detached DOM node.
      if (node) {
        chart.appendChild(node);
        return node;
      }
      node = scope.document.createElement("div");
      node.className = nodeClassName;
      node.hidden = true;
      ["touchstart", "touchmove", "touchend", "pointerdown", "click"].forEach((eventName) => {
        node.addEventListener(eventName, (event) => event.stopPropagation());
      });
      chart.appendChild(node);
      if (options.dismissOnOutsidePointer !== false) {
        outsidePointerHandler = (event) => {
          if (node.hidden
            || node.contains(event.target)
            || options.isOutsidePointerIgnored?.(event) === true) return;
          hide();
        };
        scope.document.addEventListener("pointerdown", outsidePointerHandler, true);
      }
      return node;
    }

    function destroy() {
      detachScrollIndicators();
      chartObserver?.disconnect();
      chartObserver = null;
      observedChart = null;
      if (outsidePointerHandler) {
        scope.document?.removeEventListener("pointerdown", outsidePointerHandler, true);
        outsidePointerHandler = null;
      }
      node?.remove?.();
      node = null;
    }

    function show(group, sourceEvent) {
      const popover = ensure();
      const chart = scope.document?.getElementById(chartId);
      if (!popover || !chart || !group?.events?.length) return false;
      popover.innerHTML = renderHtml(group);
      bindScrollIndicators();
      if (typeof options.onLinkAction === "function") {
        popover.querySelectorAll("a[data-link-action]").forEach((link) => {
          link.addEventListener("click", (event) => {
            const eventIndex = Number(link.dataset.eventIndex);
            const item = group.events?.[eventIndex];
            if (!item) return;
            const handled = options.onLinkAction(item, event, link);
            if (handled !== false) event.preventDefault();
          });
        });
      }
      if (typeof options.onEventAction === "function") {
        popover.querySelectorAll("[data-popover-event-action]").forEach((button) => {
          button.addEventListener("click", async (event) => {
            event.stopPropagation();
            const eventIndex = Number(button.dataset.eventIndex);
            const item = group.events?.[eventIndex];
            if (!item || button.disabled) return;
            button.disabled = true;
            try {
              const nextLabel = await options.onEventAction(item, event, button, group);
              if (typeof nextLabel === "string" && nextLabel.trim() && button.isConnected) {
                item.actionLabel = nextLabel.trim();
                button.textContent = item.actionLabel;
                button.classList.toggle(
                  "is-destructive",
                  DESTRUCTIVE_SUMMARY_ACTIONS.has(item.actionLabel),
                );
                button.setAttribute("aria-label", `${item.fullTitle || item.title || ""} ${item.actionLabel}`.trim());
              }
            } finally {
              if (button.isConnected) button.disabled = false;
            }
          });
        });
      }
      popover.querySelector("[data-popover-close]")?.addEventListener("click", (event) => {
        event.stopPropagation();
        hide();
      }, { once: true });

      const rect = chart.getBoundingClientRect();
      const anchorRect = group?.anchorElement?.getBoundingClientRect?.() || null;
      const clientX = anchorRect
        ? anchorRect.left + anchorRect.width * 0.5
        : (sourceEvent?.clientX ?? (rect.left + rect.width * 0.5));
      const clientY = anchorRect
        ? anchorRect.top + anchorRect.height * 0.5
        : (sourceEvent?.clientY ?? (rect.top + rect.height * 0.35));
      const offsetX = Number(group?.anchorOffsetX) || 0;
      const offsetY = Number(group?.anchorOffsetY) || 0;
      popover.style.width = "";
      popover.hidden = false;
      syncScrollIndicators();
      options.onVisibilityChange?.(true);
      const popoverRect = popover.getBoundingClientRect();
      const width = popoverRect.width;
      const requestedLeft = anchorRect && group?.anchorAlign === "right"
        ? anchorRect.right - rect.left - width + offsetX
        : clientX - rect.left - width * 0.5 + offsetX;
      const left = Math.max(12, Math.min(rect.width - width - 12, requestedLeft));
      const maxTop = Math.max(12, rect.height - popoverRect.height - 12);
      const top = Math.max(12, Math.min(maxTop, clientY - rect.top + 12 + offsetY));
      popover.style.left = `${left}px`;
      popover.style.top = `${top}px`;
      return true;
    }

    function toggle(group, sourceEvent) {
      if (node && !node.hidden) {
        hide();
        return false;
      }
      return show(group, sourceEvent);
    }

    return Object.freeze({ destroy, hide, isVisible: () => Boolean(node && !node.hidden), show, toggle });
  }

  function createHoverSummaryPopover(scope = globalThis, options = {}) {
    const className = [
      "chart-hover-summary",
      options.interactive ? "is-interactive" : "",
      String(options.variantClassName || "").trim(),
    ].filter(Boolean).join(" ");
    return createDisclosurePopover(scope, {
      ...options,
      className,
      dismissOnOutsidePointer: options.dismissOnOutsidePointer === true,
      renderHtml: (group) => buildHoverSummaryHtml(group, options),
    });
  }

export {
  buildHoverSummaryHtml,
  buildPopoverHtml,
  createDisclosurePopover,
  createHoverSummaryPopover,
};
