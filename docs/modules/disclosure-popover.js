(function initThinkStockDisclosurePopover(globalScope) {
  function buildPopoverHtml(group, options = {}) {
    const escapeHtml = options.escapeHtml || ((value) => String(value || ""));
    const fallbackName = options.fallbackName || (() => "");
    const items = (group?.events || []).map((event, eventIndex) => {
      const title = escapeHtml(event.title);
      const caption = String(event.caption || "").trim();
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
      return `<li>${captionHtml}${titleHtml}</li>`;
    }).join("");
    return `
      <div class="disclosure-popover-head">
        <div>
          <b>${escapeHtml(group?.name || fallbackName(group))}</b>
          <span>${escapeHtml(group?.plotDate || "")}</span>
        </div>
        <button type="button" aria-label="&#44277;&#49884; &#45803;&#44592;">&times;</button>
      </div>
      <ul>${items}</ul>
    `;
  }

  function createDisclosurePopover(scope = globalScope, options = {}) {
    const chartId = String(options.chartId || "chart");
    let node = null;

    function hide() {
      if (node) node.hidden = true;
    }

    function ensure() {
      const chart = scope.document?.getElementById(chartId);
      if (!chart) return null;
      node = node || chart.querySelector(".disclosure-popover");
      if (node) return node;
      node = scope.document.createElement("div");
      node.className = "disclosure-popover";
      node.hidden = true;
      ["touchstart", "touchmove", "touchend", "pointerdown", "click"].forEach((eventName) => {
        node.addEventListener(eventName, (event) => event.stopPropagation());
      });
      chart.appendChild(node);
      scope.document.addEventListener("pointerdown", (event) => {
        if (node.hidden || node.contains(event.target)) return;
        hide();
      }, true);
      return node;
    }

    function show(group, sourceEvent) {
      const popover = ensure();
      const chart = scope.document?.getElementById(chartId);
      if (!popover || !chart || !group?.events?.length) return false;
      popover.innerHTML = buildPopoverHtml(group, options);
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
      popover.querySelector("button")?.addEventListener("click", (event) => {
        event.stopPropagation();
        hide();
      }, { once: true });

      const rect = chart.getBoundingClientRect();
      const clientX = sourceEvent?.clientX ?? (rect.left + rect.width * 0.5);
      const clientY = sourceEvent?.clientY ?? (rect.top + rect.height * 0.35);
      popover.style.width = "";
      popover.hidden = false;
      const width = popover.getBoundingClientRect().width;
      const left = Math.max(12, Math.min(rect.width - width - 12, clientX - rect.left - width * 0.5));
      const maxTop = Math.max(12, rect.height - 180);
      const top = Math.max(12, Math.min(maxTop, clientY - rect.top + 12));
      popover.style.left = `${left}px`;
      popover.style.top = `${top}px`;
      return true;
    }

    return Object.freeze({ hide, show });
  }

  globalScope.ThinkStockDisclosurePopover = Object.freeze({
    buildPopoverHtml,
    createDisclosurePopover,
  });
}(typeof self !== "undefined" ? self : globalThis));
