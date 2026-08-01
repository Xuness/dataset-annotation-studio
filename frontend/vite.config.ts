import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

const host = process.env.TAURI_DEV_HOST;

function configuredPort(value: string | undefined, fallback: number): number {
  const port = value ? Number(value) : fallback;
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error(`Invalid development port: ${value}`);
  }
  return port;
}

const frontendPort = configuredPort(
  process.env.DATASET_STUDIO_FRONTEND_PORT || process.env.VITE_PORT,
  5173,
);
const hmr = host
  ? {
      protocol: "ws" as const,
      host,
      port: configuredPort(process.env.DATASET_STUDIO_HMR_PORT, 5200),
    }
  : undefined;

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL("./index.html", import.meta.url)),
        legacy: fileURLToPath(new URL("./legacy.html", import.meta.url)),
      },
    },
  },
  server: {
    port: frontendPort,
    strictPort: true,
    host: host || "127.0.0.1",
    hmr,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
});
