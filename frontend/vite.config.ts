import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

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
const hmrPort = configuredPort(process.env.DATASET_STUDIO_HMR_PORT, frontendPort + 1);

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: frontendPort,
    strictPort: true,
    host: host || "127.0.0.1",
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: hmrPort,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
});
