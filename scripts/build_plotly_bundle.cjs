const fs = require("node:fs");
const path = require("node:path");

const webpack = require("webpack");
const baseConfig = require("plotly.js/webpack.config.js");

const root = path.resolve(__dirname, "..");
const plotlyRoot = path.dirname(require.resolve("plotly.js/package.json"));
const target = path.join(root, "docs", "vendor", "plotly-thinkstock-2.35.2.min.js");
const temporaryIndex = path.join(plotlyRoot, "lib", "index-thinkstock.js");
const sourceIndex = path.join(plotlyRoot, "lib", "index.js");
const compressAttributes = path.join(plotlyRoot, "tasks", "compress_attributes.js");

function createScatterOnlyIndex() {
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
}

function compileBundle() {
  const config = {
    ...baseConfig,
    entry: temporaryIndex,
    module: {
      ...baseConfig.module,
      rules: [
        ...baseConfig.module.rules,
        {
          test: /\.js$/,
          use: [`transform-loader?${compressAttributes}`],
        },
      ],
    },
    optimization: { minimize: true },
    output: {
      ...baseConfig.output,
      path: path.dirname(target),
      filename: path.basename(target),
      library: {
        ...baseConfig.output.library,
        name: "Plotly",
      },
    },
  };

  return new Promise((resolve, reject) => {
    const compiler = webpack(config);
    compiler.run((error, stats) => {
      compiler.close((closeError) => {
        if (error) {
          reject(error);
          return;
        }
        if (!stats || stats.hasErrors()) {
          reject(new Error(stats?.toString({ all: false, errors: true }) || "Plotly webpack failed"));
          return;
        }
        if (closeError) {
          reject(closeError);
          return;
        }
        resolve();
      });
    });
  });
}

async function main() {
  createScatterOnlyIndex();
  try {
    await compileBundle();
    const header = "/*! plotly.js (ThinkStock scatter-only) v2.35.2 | MIT */\n";
    const output = fs.readFileSync(target);
    fs.writeFileSync(target, Buffer.concat([Buffer.from(header), output]));
    const size = fs.statSync(target).size;
    if (size >= 950_000) {
      throw new Error(`ThinkStock Plotly bundle exceeds 950000 bytes: ${size}`);
    }
    console.log(`Built ${path.relative(root, target)} (${size} bytes)`);
  } finally {
    fs.rmSync(temporaryIndex, { force: true });
  }
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
