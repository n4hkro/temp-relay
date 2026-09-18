import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  testMatch: ["**/*.spec.ts"],
  timeout: 60000,
});
