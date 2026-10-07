import { execFile, spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { isMainModule } from "./dev-ports.mjs";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));

/** @param {NodeJS.ProcessEnv} environment @param {NodeJS.Platform} platform */
export function projectRustEnvironment(environment, platform) {
  if (platform !== "linux") return { ...environment };
  const cargoHome = path.join(projectRoot, ".rust", "cargo");
  return {
    ...environment,
    CARGO_HOME: cargoHome,
    RUSTUP_HOME: path.join(projectRoot, ".rust", "rustup"),
    RUSTC: path.join(cargoHome, "bin", "rustc"),
    PATH: `${path.join(cargoHome, "bin")}${path.delimiter}${environment.PATH ?? ""}`,
  };
}

/** @param {NodeJS.ProcessEnv} environment @returns {Promise<string>} */
export function validateRustToolchain(environment) {
  const compiler = environment.RUSTC ?? "rustc";
  return new Promise((resolve, reject) => {
    execFile(
      compiler,
      ["-vV"],
      { cwd: projectRoot, env: environment, encoding: "utf8", timeout: 120000 },
      (error, stdout, stderr) => {
        if (error) {
          reject(
            new Error(
              `Rust 工具链检查失败，尚未启动 Tauri：command=${compiler} -vV，` +
                `code=${error.code}，signal=${error.signal ?? "none"}\n` +
                `stdout=${stdout}\nstderr=${stderr}\n` +
                "Linux 请执行 bash scripts/setup-rust.sh 安装项目固定工具链；" +
                "其他平台请修复 rust-toolchain.toml 对应的 rustup 工具链。",
              { cause: error },
            ),
          );
          return;
        }
        const host = /^host:\s*(\S+)$/m.exec(stdout)?.[1];
        if (!host || !/^rustc \d+\.\d+\.\d+/m.test(stdout)) {
          reject(
            new Error(
              `Rust 工具链输出缺少有效版本或 host，拒绝启动 Tauri：` +
                `command=${compiler} -vV\nstdout=${stdout}\nstderr=${stderr}`,
            ),
          );
          return;
        }
        resolve(host);
      },
    );
  });
}

async function run() {
  const [command, ...args] = process.argv.slice(2);
  if (!command)
    throw new Error(
      "缺少 Rust 命令，例如 node scripts/run-rust.mjs cargo check。",
    );
  const environment = projectRustEnvironment(process.env, process.platform);
  await validateRustToolchain(environment);
  const child = spawn(command, args, {
    cwd: projectRoot,
    env: environment,
    stdio: "inherit",
  });
  child.once("error", (error) => {
    process.stderr.write(
      `Rust 命令无法启动：command=${command}，原因=${error.message}\n`,
    );
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
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
