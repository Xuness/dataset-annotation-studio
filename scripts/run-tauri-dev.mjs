import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import process from "node:process";

import {
  applyDevPortEnvironment,
  formatPortSelection,
  isMainModule,
  selectDevPortsFromEnvironment,
} from "./dev-ports.mjs";

const require = createRequire(import.meta.url);
const tauriCliPath = require.resolve("@tauri-apps/cli/tauri.js");

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

  const child = spawn(
    process.execPath,
    [
      tauriCliPath,
      ...buildTauriArguments(process.argv.slice(2), selection.frontendPort),
    ],
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

if (isMainModule(import.meta.url)) {
  run().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`错误：${message}\n`);
    process.exitCode = 1;
  });
}
