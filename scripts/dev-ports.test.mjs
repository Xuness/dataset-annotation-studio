import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import {
  DevPortSelectionError,
  applyDevPortEnvironment,
  candidatePorts,
  DEV_PORT_SPECS,
  normalizePort,
  probeTcpPort,
  selectDevPorts,
  selectDevPortsFromEnvironment,
} from "./dev-ports.mjs";
import {
  buildDynamicTauriConfig,
  buildTauriArguments,
} from "./run-tauri-dev.mjs";

const execFileAsync = promisify(execFile);

test("candidate ranges prefer the conventional port without duplicates", () => {
  const candidates = candidatePorts(DEV_PORT_SPECS.frontend, 5180);

  assert.deepEqual(candidates.slice(0, 3), [5180, 5173, 5174]);
  assert.equal(candidates.filter((port) => port === 5180).length, 1);
  assert.equal(candidates.at(-1), 5199);
});

test("port normalization rejects privileged, malformed, and out-of-range values", () => {
  assert.equal(normalizePort(" 5173 ", "Vite"), 5173);
  assert.equal(normalizePort(undefined, "Vite"), null);
  assert.throws(() => normalizePort("5.17", "Vite"), DevPortSelectionError);
  assert.throws(() => normalizePort("80", "Vite"), DevPortSelectionError);
  assert.throws(() => normalizePort("65536", "Vite"), DevPortSelectionError);
});

test("automatic selection skips occupied defaults and reports remaining candidates", async () => {
  const occupied = new Set([5173, 8765, 8766]);
  const selection = await selectDevPorts({
    probe: async (port) => !occupied.has(port),
  });

  assert.equal(selection.frontendPort, 5174);
  assert.equal(selection.apiPort, 8767);
  assert.equal(selection.hmrPort, null);
  assert.equal(selection.availableFrontendPorts.includes(5173), false);
  assert.equal(selection.availableApiPorts.includes(8765), false);
});

test("remote HMR selection uses its own bounded range", async () => {
  const occupied = new Set([5200, 5201]);
  const selection = await selectDevPorts({
    includeHmr: true,
    probe: async (port) => !occupied.has(port),
  });

  assert.equal(selection.hmrPort, 5202);
  assert.deepEqual(selection.availableHmrPorts.slice(0, 2), [5202, 5203]);
  assert.notEqual(selection.hmrPort, selection.frontendPort);
  assert.notEqual(selection.hmrPort, selection.apiPort);
});

test("explicit ports are strict unless automatic fallback was requested", async () => {
  const probe = async (port) => port !== 6000;

  await assert.rejects(
    selectDevPorts({ frontendPort: 6000, allowFallback: false, probe }),
    /没有可用的 Vite 端口（显式端口 6000）/,
  );

  const selection = await selectDevPorts({
    frontendPort: 6000,
    allowFallback: true,
    probe,
  });
  assert.equal(selection.frontendPort, 5173);
});

test("environment selection keeps user ports strict and launcher ports automatic", async () => {
  const probe = async (port) => port !== 6100;

  await assert.rejects(
    selectDevPortsFromEnvironment({ DATASET_STUDIO_PORT: "6100" }, { probe }),
    /显式端口 6100/,
  );

  const selection = await selectDevPortsFromEnvironment(
    { DATASET_STUDIO_PORT: "6100", DATASET_STUDIO_AUTO_PORTS: "1" },
    { probe },
  );
  assert.equal(selection.apiPort, 8765);
});

test("selected ports are exported consistently to the backend and Vite", () => {
  const environment = { DATASET_STUDIO_HMR_PORT: "stale" };
  applyDevPortEnvironment(
    { frontendPort: 5180, apiPort: 8770, hmrPort: null },
    environment,
  );

  assert.deepEqual(environment, {
    DATASET_STUDIO_FRONTEND_PORT: "5180",
    DATASET_STUDIO_PORT: "8770",
    VITE_API_BASE_URL: "http://127.0.0.1:8770",
  });
});

test("Tauri development arguments apply the dynamic URL after runtime config", () => {
  assert.deepEqual(buildDynamicTauriConfig(5180), {
    build: { devUrl: "http://127.0.0.1:5180" },
  });
  assert.deepEqual(
    buildTauriArguments(["src-tauri/tauri.cuda.conf.json"], 5180),
    [
      "dev",
      "--config",
      "src-tauri/tauri.cuda.conf.json",
      "--config",
      '{"build":{"devUrl":"http://127.0.0.1:5180"}}',
    ],
  );
});

test("development port CLI runs through a linked checkout path", async (context) => {
  const temporaryRoot = await mkdtemp(
    path.join(tmpdir(), "dataset-studio-dev-ports-"),
  );
  const checkoutAlias = path.join(temporaryRoot, "checkout");
  const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
  try {
    try {
      await symlink(
        repositoryRoot,
        checkoutAlias,
        process.platform === "win32" ? "junction" : "dir",
      );
    } catch (error) {
      if (error?.code === "EPERM" || error?.code === "EACCES") {
        context.skip("the environment does not allow directory links");
        return;
      }
      throw error;
    }

    const environment = { ...process.env };
    for (const key of [
      "DATASET_STUDIO_FRONTEND_PORT",
      "DATASET_STUDIO_PORT",
      "DATASET_STUDIO_HMR_PORT",
      "DATASET_STUDIO_AUTO_PORTS",
      "VITE_PORT",
      "TAURI_DEV_HOST",
    ]) {
      delete environment[key];
    }
    const { stdout } = await execFileAsync(
      process.execPath,
      [path.join(checkoutAlias, "scripts", "dev-ports.mjs"), "--json"],
      { env: environment },
    );
    const selection = JSON.parse(stdout);

    assert.equal(Number.isInteger(selection.frontendPort), true);
    assert.equal(Number.isInteger(selection.apiPort), true);
    assert.equal(selection.hmrPort, null);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("the TCP probe observes a loopback listener and its release", async (context) => {
  const server = createServer();
  let closed = false;
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen({ host: "127.0.0.1", port: 0, exclusive: true }, resolve);
    });
  } catch (error) {
    if (error?.code === "EPERM") {
      context.skip("the sandbox does not allow loopback bind probes");
      return;
    }
    throw error;
  }

  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    assert.equal(await probeTcpPort(address.port), false);
    await new Promise((resolve, reject) => {
      server.close((closeError) =>
        closeError ? reject(closeError) : resolve(),
      );
    });
    closed = true;
    assert.equal(await probeTcpPort(address.port), true);
  } finally {
    if (!closed) server.close();
  }
});
