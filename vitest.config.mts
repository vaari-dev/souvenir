import { defineConfig } from "vitest/config";

// The exclude matters: `next build` copies lib/ and its tests into .next/standalone, and
// without it the suite runs those stale copies instead of the working tree.
export default defineConfig({
  test: {
    include: ["lib/**/*.test.ts", "scripts/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/.next/**"],
  },
});
