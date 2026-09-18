import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Yalnız unit testlər; brauzer testləri tests/e2e/-dədir (playwright).
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
