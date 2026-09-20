import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export default class WebkitTimingReporter {
  records = [];

  onTestEnd(test, result) {
    this.records.push({
      title: test.titlePath().filter(Boolean).join(" > "),
      file: path.relative(process.cwd(), test.location.file).replaceAll("\\", "/"),
      durationMs: result.duration,
      retry: result.retry,
      status: result.status,
      expectedStatus: test.expectedStatus,
      bootMs: test.annotations.filter((entry) => entry.type === "boot-ms")
        .map((entry) => Number(entry.description)),
    });
  }

  async onEnd(result) {
    const output = process.env.THINKSTOCK_WEBKIT_TIMINGS;
    if (!output) return;
    const records = this.records.sort((a, b) => b.durationMs - a.durationMs);
    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(output, JSON.stringify({
      status: result.status,
      durationMs: result.duration,
      retries: records.filter((entry) => entry.retry > 0).length,
      records,
    }, null, 2));
    console.log(`WebKit timings: ${path.relative(process.cwd(), output)}; ${records.length} attempts, ${records.filter((entry) => entry.retry > 0).length} retries`);
    for (const entry of records.slice(0, 5)) {
      console.log(`  ${(entry.durationMs / 1000).toFixed(1)}s ${entry.title} [${entry.status}, retry ${entry.retry}]`);
    }
  }
}
