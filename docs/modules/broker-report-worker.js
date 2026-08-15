const versionQuery = new URL(self.location.href).search;
const pdfModuleUrl = new URL(`../vendor/pdf.min.mjs${versionQuery}`, self.location.href).toString();
const pdfWorkerUrl = new URL(`../vendor/pdf.worker.min.mjs${versionQuery}`, self.location.href).toString();
let pdfModuleTask = null;

function loadPdfModule() {
  if (!pdfModuleTask) {
    pdfModuleTask = import(pdfModuleUrl).then((module) => {
      if (module.GlobalWorkerOptions) module.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
      return module;
    }).catch((error) => {
      pdfModuleTask = null;
      throw error;
    });
  }
  return pdfModuleTask;
}

function lineItemsFromTextContent(textContent) {
  const rows = [];
  (Array.isArray(textContent?.items) ? textContent.items : []).forEach((item) => {
    const text = String(item?.str || "").replace(/\s+/g, " ").trim();
    if (!text) return;
    const x = Number(item?.transform?.[4]) || 0;
    const y = Number(item?.transform?.[5]) || 0;
    let row = rows.find((candidate) => Math.abs(candidate.y - y) <= 1.8);
    if (!row) {
      row = { y, items: [] };
      rows.push(row);
    }
    row.items.push({ x, text });
  });
  return rows
    .sort((left, right) => right.y - left.y)
    .map((row) => row.items
      .sort((left, right) => left.x - right.x)
      .map((item) => item.text)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim())
    .filter(Boolean);
}

self.onmessage = async (event) => {
  const id = Number(event.data?.id);
  if (!Number.isInteger(id)) return;
  let loadingTask = null;
  let pdf = null;
  try {
    const bytes = new Uint8Array(event.data?.bytes || 0);
    if (!bytes.byteLength) throw new Error("Broker report PDF is empty");
    const pdfjs = await loadPdfModule();
    loadingTask = pdfjs.getDocument({
      data: bytes,
      isEvalSupported: false,
      useSystemFonts: true,
    });
    pdf = await loadingTask.promise;
    const pages = [];
    const maximum = Math.min(12, pdf.numPages);
    for (let pageNumber = 1; pageNumber <= maximum; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const textContent = await page.getTextContent({ disableNormalization: false });
      pages.push({ page: pageNumber, lines: lineItemsFromTextContent(textContent) });
      page.cleanup?.();
    }
    self.postMessage({ id, pages });
  } catch (error) {
    self.postMessage({ id, error: String(error?.message || error || "Broker report PDF parsing failed") });
  } finally {
    if (typeof pdf?.destroy === "function") await pdf.destroy().catch(() => {});
    else await loadingTask?.destroy?.().catch(() => {});
  }
};
