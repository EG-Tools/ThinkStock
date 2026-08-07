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
  const render = await page.evaluate(() => ({
    version: document.getElementById("appVersionText")?.textContent?.trim() || "",
    chartHeight: Math.round(document.getElementById("chart")?.getBoundingClientRect().height || 0),
    traces: document.querySelectorAll("#chart .scatterlayer .trace").length,
    mainSvg: Boolean(document.querySelector("#chart .main-svg")),
  }));
  const result = { status: response?.status() || 0, ...render, pageErrors };
  console.log(JSON.stringify(result, null, 2));
  if (result.status !== 200 || !result.mainSvg || result.chartHeight <= 0 || result.traces <= 0) {
    process.exitCode = 1;
  }
} finally {
  await browser.close();
}
