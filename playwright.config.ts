import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.visual.ts",
  fullyParallel: false,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:3190",
    browserName: "chromium",
    launchOptions: { executablePath: "/usr/bin/chromium", args: ["--no-sandbox"] },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev -- --hostname 127.0.0.1 --port 3190",
    url: "http://127.0.0.1:3190",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  snapshotPathTemplate: "{testDir}/snapshots/{arg}{ext}",
});
