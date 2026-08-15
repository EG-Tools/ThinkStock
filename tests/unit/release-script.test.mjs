import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("release script parses GitHub run status without shell-sensitive jq quoting", async () => {
  const source = await readFile(new URL("../../scripts/release_pages.ps1", import.meta.url), "utf8");
  assert.doesNotMatch(source, /--jq/);
  assert.match(source, /ConvertFrom-Json/);
});

test("release script excludes personal iPhone preview files from commits", async () => {
  const source = await readFile(new URL("../../scripts/release_pages.ps1", import.meta.url), "utf8");
  assert.doesNotMatch(source, /"add", "-A"/);
  assert.doesNotMatch(source, /"run_local_iphone13promax\.bat"/);
  assert.match(source, /:\(exclude\)scripts\/resize_preview_window\.ps1/);
});

test("release script includes reproducibility documentation and Qlib requirements", async () => {
  const source = await readFile(new URL("../../scripts/release_pages.ps1", import.meta.url), "utf8");
  assert.match(source, /"README\.md"/);
  assert.match(source, /"requirements-qlib\.txt"/);
});

test("release script can skip only the duplicate local verification", async () => {
  const source = await readFile(new URL("../../scripts/release_pages.ps1", import.meta.url), "utf8");
  const launcher = await readFile(new URL("../../deploy_pages.bat", import.meta.url), "utf8");
  assert.match(source, /\[switch\]\$SkipVerification/);
  assert.match(source, /if \(-not \$SkipVerification\) \{\s*Invoke-Checked npm @\("run", "verify:release"\)/);
  assert.match(launcher, /--skip-verified/);
  assert.match(launcher, /-SkipVerification/);
});

test("release reuses local full WebKit verification while direct runs stay fail-safe", async () => {
  const source = await readFile(new URL("../../scripts/release_pages.ps1", import.meta.url), "utf8");
  const workflow = await readFile(new URL("../../.github/workflows/deploy-pages.yml", import.meta.url), "utf8");
  assert.match(source, /\$GitHubVerificationScope = "smoke"/);
  assert.match(source, /Invoke-Checked npm @\("run", "verify:release"\)/);
  assert.match(source, /verification_scope=\$GitHubVerificationScope/);
  assert.match(workflow, /verification_scope:[\s\S]*default: full/);
  assert.match(workflow, /run_webkit_scope\.mjs release \$\{\{ inputs\.verification_scope \}\}/);
  assert.doesNotMatch(workflow, /matrix\.target/);
});

test("release script can publish an already prepared version without incrementing it", async () => {
  const source = await readFile(new URL("../../scripts/release_pages.ps1", import.meta.url), "utf8");
  const launcher = await readFile(new URL("../../deploy_pages.bat", import.meta.url), "utf8");
  assert.match(source, /\[switch\]\$KeepVersion/);
  assert.match(source, /if \(-not \$KeepVersion\) \{\s*Invoke-Checked npm @\("run", "version:pages"\)/);
  assert.match(launcher, /--keep-version/);
  assert.match(launcher, /-KeepVersion/);
  assert.match(launcher, /--keep-version[\s\S]*--skip-verified[\s\S]*-KeepVersion -SkipVerification/);
});

test("release script can deploy an already pushed reproducible commit", async () => {
  const source = await readFile(new URL("../../scripts/release_pages.ps1", import.meta.url), "utf8");
  const launcher = await readFile(new URL("../../deploy_pages.bat", import.meta.url), "utf8");
  assert.match(source, /\[switch\]\$PreparedCommit/);
  assert.match(source, /Prepared releases require HEAD to match origin\/main/);
  assert.match(source, /The prepared commit does not contain the reproducible release output/);
  assert.match(launcher, /--prepared/);
  assert.match(launcher, /-KeepVersion -SkipVerification -PreparedCommit/);
});

test("release script refreshes deployment data only when explicitly requested", async () => {
  const source = await readFile(new URL("../../scripts/release_pages.ps1", import.meta.url), "utf8");
  const launcher = await readFile(new URL("../../deploy_pages.bat", import.meta.url), "utf8");
  assert.match(source, /\[switch\]\$RefreshData/);
  assert.match(source, /refresh_data=\$\(\$RefreshData\.IsPresent/);
  assert.match(launcher, /--refresh-data/);
  assert.match(launcher, /-RefreshData/);
});

test("deployment shares the diagnostic bundle with every WebKit validation job", async () => {
  const workflow = await readFile(new URL("../../.github/workflows/deploy-pages.yml", import.meta.url), "utf8");
  assert.match(workflow, /name: Upload E2E Diagnostic Bundle[\s\S]*name: thinkstock-e2e-bundle[\s\S]*path: \.thinkstock-cache\/e2e\/app\.bundle\.min\.js/);
  assert.match(workflow, /name: Download E2E Diagnostic Bundle[\s\S]*name: thinkstock-e2e-bundle[\s\S]*path: \.thinkstock-cache\/e2e/);
});

test("WebKit plan keeps full iPhone coverage without duplicating non-visual desktop cases", async () => {
  const config = await readFile(new URL("../../playwright.config.mjs", import.meta.url), "utf8");
  const packageJson = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8"));

  assert.match(config, /name: "webkit",[\s\S]*testMatch: \/thinkstock-\.\*\\\.spec\\\.mjs\//);
  assert.match(config, /name: "webkit-desktop",[\s\S]*testMatch: \/thinkstock-viewport\\\.spec\\\.mjs\//);
  assert.match(packageJson.scripts["test:webkit:built"], /--workers=2/);
});
