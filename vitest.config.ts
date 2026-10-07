import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // 测试文件放在 tests/ 目录，文件名 *.test.ts
    include: ["tests/**/*.test.ts", "tests/**/*.test.mjs"],
    environment: "node",
    // 直接运行 .ts 源文件，无需转译
    deps: {
      optimizer: { ssr: { enabled: false }, web: { enabled: false } },
    },
    // `npx vitest run --coverage` 生成覆盖率；只统计插件源码
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.d.ts"],
      reporter: ["text-summary", "json-summary"],
    },
  },
});
