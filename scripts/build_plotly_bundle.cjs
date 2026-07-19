const path = require("node:path");
const fs = require("node:fs");

const bundle = require("plotly.js/tasks/util/bundle_wrapper");

const root = path.resolve(__dirname, "..");
const plotlyRoot = path.dirname(require.resolve("plotly.js/package.json"));
const target = path.join(root, "docs", "vendor", "plotly-thinkstock-2.35.2.min.js");
const temporaryIndex = path.join(plotlyRoot, "lib", "index-thinkstock.js");
const sourceIndex = path.join(plotlyRoot, "lib", "index.js");
const traceNames = fs.readdirSync(path.join(plotlyRoot, "src", "traces"))
  .filter((name) => name[0] === name[0].toLowerCase());
const transformNames = fs.readdirSync(path.join(plotlyRoot, "src", "transforms"))
  .filter((name) => name[0] === name[0].toLowerCase() && name !== "helpers.js")
  .map((name) => name.replace(/\.js$/, ""));
let indexSource = fs.readFileSync(sourceIndex, "utf8");

["calendars", ...transformNames, ...traceNames]
  .filter((name) => name !== "scatter")
  .forEach((name) => {
    const pattern = new RegExp(`\\s*require\\('\\./${name}'\\),`, "g");
    const nextSource = indexSource.replace(pattern, "");
    if (nextSource === indexSource) throw new Error(`Unable to exclude Plotly module: ${name}`);
    indexSource = nextSource;
  });
fs.writeFileSync(temporaryIndex, indexSource);

bundle(temporaryIndex, null, { pathToMinBundle: target }, () => {
  fs.rmSync(temporaryIndex, { force: true });
  const header = "/*! plotly.js (ThinkStock scatter-only) v2.35.2 | MIT */\n";
  const output = fs.readFileSync(target);
  fs.writeFileSync(target, Buffer.concat([Buffer.from(header), output]));
  const size = fs.statSync(target).size;
  if (size >= 950_000) {
    throw new Error(`ThinkStock Plotly bundle exceeds 950000 bytes: ${size}`);
  }
  console.log(`Built ${path.relative(root, target)} (${size} bytes)`);
});
