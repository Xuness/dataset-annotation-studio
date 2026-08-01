import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    include: ["Legacy/tests/ui/**/*.test.tsx"],
    restoreMocks: true,
    setupFiles: ["Legacy/tests/ui/setup.ts"],
  },
});
