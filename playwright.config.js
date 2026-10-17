import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/browser",
  fullyParallel: true,
  workers: 3,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: "list",
  use: {
    baseURL: process.env.TEST_BASE_URL || "http://127.0.0.1:4173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: process.env.TEST_BASE_URL
    ? undefined
    : {
        command: "node scripts/server.mjs",
        url: "http://127.0.0.1:4173",
        reuseExistingServer: true,
      },
  projects: [
    {
      name: "desktop-chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
      },
    },
    {
      name: "mobile-chromium",
      use: { ...devices["iPhone 14"], defaultBrowserType: "chromium" },
    },
    {
      name: "mobile-webkit",
      use: { ...devices["iPhone 14"], defaultBrowserType: "webkit" },
    },
  ],
});
