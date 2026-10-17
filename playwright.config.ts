import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.visual.ts",
  fullyParallel: false,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:3190",
    browserName: "chromium",
    channel: "chromium",
    launchOptions: { args: ["--no-sandbox"] },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run build && npm run start -- --hostname 127.0.0.1 --port 3190",
    url: "http://127.0.0.1:3190",
    reuseExistingServer: false,
    timeout: 120_000,
  },
  snapshotPathTemplate: "{testDir}/snapshots/{arg}{ext}",
});
