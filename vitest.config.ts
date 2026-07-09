import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // 测试文件放在 tests/ 目录，文件名 *.test.ts
    include: ["tests/**/*.test.ts"],
    environment: "node",
    // 直接运行 .ts 源文件，无需转译
    deps: {
      optimizer: { ssr: { enabled: false }, web: { enabled: false } },
    },
  },
});
