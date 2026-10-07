import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { projectRustEnvironment, validateRustToolchain } from "./run-rust.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const execute = promisify(execFile);

test("Linux uses a project toolchain without mutating its input environment", () => {
  const input = Object.freeze({
    PATH: "/usr/bin",
    DATASET_STUDIO_PORT: "8765",
  });
  const environment = projectRustEnvironment(input, "linux");
  assert.equal(environment.CARGO_HOME, path.join(root, ".rust", "cargo"));
  assert.equal(environment.RUSTUP_HOME, path.join(root, ".rust", "rustup"));
  assert.equal(
    environment.RUSTC,
    path.join(root, ".rust", "cargo", "bin", "rustc"),
  );
  assert.equal(
    environment.PATH.split(path.delimiter)[0],
    path.join(environment.CARGO_HOME, "bin"),
  );
  assert.equal(environment.DATASET_STUDIO_PORT, "8765");
  assert.equal(input.PATH, "/usr/bin");
});

test("the real configured compiler reports a usable host and reads the actual Cargo project", async () => {
  const environment = projectRustEnvironment(process.env, process.platform);
  const host = await validateRustToolchain(environment);
  assert.match(host, /\S+-\S+-\S+/);
  const { stdout } = await execute(
    process.execPath,
    [
      path.join(root, "scripts", "run-rust.mjs"),
      "cargo",
      "metadata",
      "--manifest-path",
      "src-tauri/Cargo.toml",
      "--no-deps",
      "--format-version",
      "1",
    ],
    { cwd: root, env: process.env, encoding: "utf8" },
  );
  const metadata = JSON.parse(stdout);
  assert.equal(metadata.packages[0].name, "dataset-annotation-studio");
});

test("a missing real compiler fails before Tauri with its exact command and cause", async () => {
  const environment = {
    ...projectRustEnvironment(process.env, process.platform),
    RUSTC: path.join(root, ".rust", "does-not-exist", "rustc"),
  };
  await assert.rejects(validateRustToolchain(environment), (error) => {
    assert.match(error.message, /尚未启动 Tauri/);
    assert.match(error.message, /ENOENT/);
    assert.ok(error.message.includes(environment.RUSTC));
    return true;
  });
});
