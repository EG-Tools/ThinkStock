import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "line",
  use: {
    baseURL: "http://127.0.0.1:4173",
    serviceWorkers: "block",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "webkit",
      testMatch: /iphone-smoke\.spec\.mjs/,
      use: { ...devices["iPhone 13"] },
    },
    {
      name: "webkit-desktop",
      testMatch: /iphone-smoke\.spec\.mjs/,
      use: { ...devices["Desktop Safari"] },
    },
    {
      name: "webkit-sw",
      testMatch: /service-worker\.spec\.mjs/,
      use: {
        ...devices["Desktop Safari"],
        serviceWorkers: "allow",
      },
    },
  ],
  webServer: {
    command: "node scripts/serve_pages.mjs",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: !process.env.CI,
    timeout: 20_000,
  },
});
