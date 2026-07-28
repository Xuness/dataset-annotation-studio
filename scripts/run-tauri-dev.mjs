import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  applyDevPortEnvironment,
  formatPortSelection,
  selectDevPortsFromEnvironment,
} from "./dev-ports.mjs";

export function buildDynamicTauriConfig(frontendPort) {
  return {
    build: {
      devUrl: `http://127.0.0.1:${frontendPort}`,
    },
  };
}

export function buildTauriArguments(configPaths, frontendPort) {
  const configurationArguments = configPaths.flatMap((configPath) => [
    "--config",
    configPath,
  ]);
  return [
    "exec",
    "tauri",
    "dev",
    ...configurationArguments,
    "--config",
    JSON.stringify(buildDynamicTauriConfig(frontendPort)),
  ];
}

async function run() {
  const selection = await selectDevPortsFromEnvironment();
  applyDevPortEnvironment(selection);
  process.env.DATASET_STUDIO_AUTO_PORTS = "1";
  process.stdout.write(
    `[Dataset Studio] 使用开发端口：${formatPortSelection(selection)}\n`,
  );

  const packageManager = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  const child = spawn(
    packageManager,
    buildTauriArguments(process.argv.slice(2), selection.frontendPort),
    {
      env: process.env,
      stdio: "inherit",
    },
  );

  child.once("error", (error) => {
    process.stderr.write(`错误：无法启动 Tauri CLI：${error.message}\n`);
    process.exitCode = 1;
  });
  child.once("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exitCode = code ?? 1;
  });
}

const isMainModule =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) ===
    path.resolve(fileURLToPath(import.meta.url));

if (isMainModule) {
  run().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`错误：${message}\n`);
    process.exitCode = 1;
  });
}
