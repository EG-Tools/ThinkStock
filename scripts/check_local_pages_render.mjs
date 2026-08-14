import { webkit } from "playwright";

const url = process.argv[2] || "http://127.0.0.1:8787/";
const browser = await webkit.launch({ headless: true });

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const response = await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#chart .main-svg", { timeout: 30_000 });
  await page.waitForTimeout(5_000);
  const initial = await page.evaluate(() => ({
    version: document.getElementById("appVersionText")?.textContent?.trim() || "",
    chartHeight: Math.round(document.getElementById("chart")?.getBoundingClientRect().height || 0),
    traces: document.querySelectorAll("#chart .scatterlayer .trace").length,
    mainSvg: Boolean(document.querySelector("#chart .main-svg")),
    handles: document.querySelectorAll("#y-handles .y-handle").length,
    leftMargin: Number(document.getElementById("chart")?._fullLayout?.margin?.l),
    auxiliaryLeftMargin: Number(document.getElementById("chart-adr")?._fullLayout?.margin?.l),
  }));
  await page.click("#chartHandlesToggle");
  await page.waitForFunction(() => (
    document.querySelector(".main-chart-wrap")?.classList.contains("handles-hidden")
    && !document.getElementById("y-handles")
    && Number(document.getElementById("chart")?._fullLayout?.margin?.l) === 36
  ));
  const hiddenHandles = await page.evaluate(() => ({
    handles: document.querySelectorAll("#y-handles .y-handle").length,
    leftMargin: Number(document.getElementById("chart")?._fullLayout?.margin?.l),
    auxiliaryLeftMargin: Number(document.getElementById("chart-adr")?._fullLayout?.margin?.l),
  }));
  await page.click("#chartHandlesToggle");
  await page.waitForFunction(() => (
    !document.querySelector(".main-chart-wrap")?.classList.contains("handles-hidden")
    && document.querySelectorAll("#y-handles .y-handle").length > 0
    && Number(document.getElementById("chart")?._fullLayout?.margin?.l) === 36
  ));
  const restoredHandles = await page.evaluate(() => ({
    handles: document.querySelectorAll("#y-handles .y-handle").length,
    leftMargin: Number(document.getElementById("chart")?._fullLayout?.margin?.l),
    auxiliaryLeftMargin: Number(document.getElementById("chart-adr")?._fullLayout?.margin?.l),
  }));
  const result = {
    status: response?.status() || 0,
    ...initial,
    hiddenHandles,
    restoredHandles,
    pageErrors,
  };
  console.log(JSON.stringify(result, null, 2));
  if (
    result.status !== 200
    || !result.mainSvg
    || result.chartHeight <= 0
    || result.traces <= 0
    || result.handles <= 0
    || result.leftMargin !== 36
    || result.auxiliaryLeftMargin !== 36
    || hiddenHandles.handles !== 0
    || hiddenHandles.leftMargin !== 36
    || hiddenHandles.auxiliaryLeftMargin !== 36
    || restoredHandles.handles <= 0
    || restoredHandles.leftMargin !== 36
    || restoredHandles.auxiliaryLeftMargin !== 36
  ) {
    process.exitCode = 1;
  }
} finally {
  await browser.close();
}
