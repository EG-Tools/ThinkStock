import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("release script parses GitHub run status without shell-sensitive jq quoting", async () => {
  const source = await readFile(new URL("../../scripts/release_pages.ps1", import.meta.url), "utf8");
  assert.doesNotMatch(source, /--jq/);
  assert.match(source, /ConvertFrom-Json/);
});

test("release script includes shared rules and reproducible local launch helpers", async () => {
  const source = await readFile(new URL("../../scripts/release_pages.ps1", import.meta.url), "utf8");
  assert.doesNotMatch(source, /"add", "-A"/);
  assert.match(source, /"\.gitattributes"/);
  assert.match(source, /"AGENTS\.md"/);
  assert.match(source, /"run_local_iphone13promax\.bat"/);
  assert.match(source, /"scripts"/);
  assert.doesNotMatch(source, /:\(exclude\)scripts\/resize_preview_window\.ps1/);
  assert.match(source, /Assert-ReleaseWorkspaceReady/);
  assert.doesNotMatch(source, /TrimStart\(\[char\[\]\]"\.\/"\)/);
  assert.match(source, /\$normalized = \$normalized -replace "\^\\\.\/", ""/);
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

test("release reuses local full WebKit verification while CI splits browser scopes", async () => {
  const source = await readFile(new URL("../../scripts/release_pages.ps1", import.meta.url), "utf8");
  const workflow = await readFile(new URL("../../.github/workflows/deploy-pages.yml", import.meta.url), "utf8");
  assert.match(source, /\$GitHubVerificationScope = "smoke"/);
  assert.match(source, /Invoke-Checked npm @\("run", "verify:release"\)/);
  assert.match(source, /verification_scope=\$GitHubVerificationScope/);
  assert.match(workflow, /verification_scope:[\s\S]*default: full/);
  assert.match(workflow, /target: \[mobile, desktop, sw\]/);
  assert.match(workflow, /run_webkit_scope\.mjs \$\{\{ matrix\.target \}\} \$\{\{ inputs\.verification_scope \}\}/);
  assert.match(workflow, /fail-fast: false/);
});

test("release script always publishes the authoritative local version", async () => {
  const source = await readFile(new URL("../../scripts/release_pages.ps1", import.meta.url), "utf8");
  const launcher = await readFile(new URL("../../deploy_pages.bat", import.meta.url), "utf8");
  assert.match(source, /\[switch\]\$KeepVersion/);
  assert.doesNotMatch(source, /Invoke-Checked npm @\("run", "version:pages"\)/);
  assert.match(source, /authoritative local app version/);
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

test("release deploys and value-checks the Worker before dispatching Pages", async () => {
  const source = await readFile(new URL("../../scripts/release_pages.ps1", import.meta.url), "utf8");
  const deployAt = source.indexOf('Invoke-Checked npm @("run", "worker:deploy")');
  const parityAt = source.indexOf('Invoke-Checked npm @("run", "verify:runtime-parity")');
  const pagesAt = source.indexOf('Invoke-Checked gh @(');
  assert.ok(deployAt > 0);
  assert.ok(parityAt > deployAt);
  assert.ok(pagesAt > parityAt);
});

test("deployment shares the diagnostic bundle with every WebKit validation job", async () => {
  const workflow = await readFile(new URL("../../.github/workflows/deploy-pages.yml", import.meta.url), "utf8");
  assert.match(workflow, /name: Upload E2E Diagnostic Bundle[\s\S]*name: thinkstock-e2e-bundle[\s\S]*path: \.thinkstock-cache\/e2e\/app\.bundle\.min\.js/);
  assert.match(workflow, /name: Download E2E Diagnostic Bundle[\s\S]*name: thinkstock-e2e-bundle[\s\S]*path: \.thinkstock-cache\/e2e/);
});

test("deployment reuses exact Node 24 dependencies without weakening cache invalidation", async () => {
  const workflow = await readFile(new URL("../../.github/workflows/deploy-pages.yml", import.meta.url), "utf8");
  assert.ok((workflow.match(/path: node_modules/g) || []).length >= 2);
  assert.match(workflow, /thinkstock-node24-\$\{\{ runner\.os \}\}-\$\{\{ hashFiles\('package-lock\.json'\) \}\}/);
  assert.ok((workflow.match(/outputs\.cache-hit != 'true'/g) || []).length >= 2);
  assert.match(workflow, /npm ci --prefer-offline --no-audit --no-fund/);
});

test("WebKit plan keeps full iPhone coverage without duplicating non-visual desktop cases", async () => {
  const config = await readFile(new URL("../../playwright.config.mjs", import.meta.url), "utf8");
  const packageJson = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8"));

  assert.match(config, /name: "webkit",[\s\S]*testMatch: \/thinkstock-\.\*\\\.spec\\\.mjs\//);
  assert.match(config, /name: "webkit-desktop",[\s\S]*testMatch: \/thinkstock-viewport\\\.spec\\\.mjs\//);
  assert.match(packageJson.scripts["test:webkit:built"], /--workers=1/);
});
