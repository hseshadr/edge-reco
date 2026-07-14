import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      // types.ts is type-only (no runtime); index.ts is a re-export barrel.
      exclude: ["src/types.ts", "src/index.ts"],
      // ENGINEERING-STANDARDS §2 TypeScript floor (mirrors @edgeproc/privacy-core).
      thresholds: {
        lines: 90,
        functions: 90,
        branches: 85,
      },
    },
  },
});
