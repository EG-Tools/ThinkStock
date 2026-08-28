import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { staticContentType } from "./static_content_type.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "docs");
const e2eBundlePath = path.resolve(root, "..", ".thinkstock-cache", "e2e", "app.bundle.min.js");
const port = Number(process.env.PORT || 4173);
createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://${request.headers.host || "127.0.0.1"}`);
    const relative = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
    // This server exists only for Playwright. Always use the diagnostic build so
    // browser referrer policy cannot silently disable the E2E control surface.
    const useE2eBundle = relative === "/assets/app.bundle.min.js";
    const filePath = useE2eBundle ? e2eBundlePath : path.resolve(root, `.${relative}`);
    if (!useE2eBundle && filePath !== root && !filePath.startsWith(`${root}${path.sep}`)) {
      throw new Error("invalid path");
    }
    const info = await stat(filePath);
    if (!info.isFile()) throw new Error("not a file");
    response.writeHead(200, {
      "cache-control": "no-store",
      "content-length": info.size,
      "content-type": staticContentType(filePath),
    });
    createReadStream(filePath).pipe(response);
  } catch (_) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
}).listen(port, "127.0.0.1", () => {
  console.log(`ThinkStock test server listening on http://127.0.0.1:${port}`);
});
