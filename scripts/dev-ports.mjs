import { createServer } from "node:net";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const LOOPBACK_HOST = "127.0.0.1";
const MIN_UNPRIVILEGED_PORT = 1024;
const MAX_PORT = 65_535;

export const DEV_PORT_SPECS = Object.freeze({
  frontend: Object.freeze({
    label: "Vite",
    preferred: 5173,
    start: 5173,
    end: 5199,
  }),
  api: Object.freeze({ label: "API", preferred: 8765, start: 8765, end: 8799 }),
  hmr: Object.freeze({ label: "HMR", preferred: 5200, start: 5200, end: 5225 }),
});

export class DevPortSelectionError extends Error {
  constructor(message) {
    super(message);
    this.name = "DevPortSelectionError";
  }
}

export function normalizePort(value, label) {
  if (value === undefined || value === null || String(value).trim() === "")
    return null;
  const text = String(value).trim();
  if (!/^\d+$/.test(text)) {
    throw new DevPortSelectionError(`${label}端口必须是整数：${text}`);
  }
  const port = Number(text);
  if (
    !Number.isSafeInteger(port) ||
    port < MIN_UNPRIVILEGED_PORT ||
    port > MAX_PORT
  ) {
    throw new DevPortSelectionError(
      `${label}端口必须位于 ${MIN_UNPRIVILEGED_PORT}-${MAX_PORT}：${text}`,
    );
  }
  return port;
}

export function candidatePorts(spec, requestedPort = null) {
  const candidates = [];
  if (requestedPort !== null) candidates.push(requestedPort);
  candidates.push(spec.preferred);
  for (let port = spec.start; port <= spec.end; port += 1)
    candidates.push(port);
  return [...new Set(candidates)];
}

export function probeTcpPort(port, host = LOOPBACK_HOST) {
  return new Promise((resolve) => {
    const server = createServer();
    let settled = false;
    const finish = (available) => {
      if (settled) return;
      settled = true;
      resolve(available);
    };

    server.once("error", () => finish(false));
    server.listen({ host, port, exclusive: true }, () => {
      server.close(() => finish(true));
    });
  });
}

async function choosePort({
  spec,
  requestedPort,
  allowFallback,
  excludedPorts,
  probe,
}) {
  const candidates = allowFallback
    ? candidatePorts(spec, requestedPort)
    : requestedPort === null
      ? candidatePorts(spec)
      : [requestedPort];
  const availablePorts = [];

  for (const port of candidates) {
    if (excludedPorts.has(port)) continue;
    if (await probe(port)) availablePorts.push(port);
  }

  if (availablePorts.length === 0) {
    const scope =
      requestedPort !== null && !allowFallback
        ? `显式端口 ${requestedPort}`
        : `候选范围 ${spec.start}-${spec.end}`;
    throw new DevPortSelectionError(
      `没有可用的 ${spec.label} 端口（${scope}）。`,
    );
  }

  return {
    selectedPort: availablePorts[0],
    availablePorts,
  };
}

export async function selectDevPorts({
  frontendPort = null,
  apiPort = null,
  hmrPort = null,
  includeHmr = false,
  allowFallback = true,
  probe = probeTcpPort,
} = {}) {
  const normalizedFrontendPort = normalizePort(frontendPort, "Vite");
  const normalizedApiPort = normalizePort(apiPort, "API");
  const normalizedHmrPort = normalizePort(hmrPort, "HMR");
  const excludedPorts = new Set();

  const frontend = await choosePort({
    spec: DEV_PORT_SPECS.frontend,
    requestedPort: normalizedFrontendPort,
    allowFallback,
    excludedPorts,
    probe,
  });
  excludedPorts.add(frontend.selectedPort);

  const api = await choosePort({
    spec: DEV_PORT_SPECS.api,
    requestedPort: normalizedApiPort,
    allowFallback,
    excludedPorts,
    probe,
  });
  excludedPorts.add(api.selectedPort);

  let hmr = null;
  if (includeHmr) {
    hmr = await choosePort({
      spec: DEV_PORT_SPECS.hmr,
      requestedPort: normalizedHmrPort,
      allowFallback,
      excludedPorts,
      probe,
    });
  }

  return {
    frontendPort: frontend.selectedPort,
    apiPort: api.selectedPort,
    hmrPort: hmr?.selectedPort ?? null,
    availableFrontendPorts: frontend.availablePorts,
    availableApiPorts: api.availablePorts,
    availableHmrPorts: hmr?.availablePorts ?? [],
  };
}

export async function selectDevPortsFromEnvironment(
  environment = process.env,
  { forceAuto = false, probe = probeTcpPort } = {},
) {
  const configuredFrontendPort =
    environment.DATASET_STUDIO_FRONTEND_PORT ?? environment.VITE_PORT;
  const configuredApiPort = environment.DATASET_STUDIO_PORT;
  const configuredHmrPort = environment.DATASET_STUDIO_HMR_PORT;
  const hasExplicitPort = [
    configuredFrontendPort,
    configuredApiPort,
    configuredHmrPort,
  ].some((value) => value !== undefined && String(value).trim() !== "");
  const allowFallback =
    forceAuto ||
    environment.DATASET_STUDIO_AUTO_PORTS === "1" ||
    !hasExplicitPort;

  return selectDevPorts({
    frontendPort: configuredFrontendPort,
    apiPort: configuredApiPort,
    hmrPort: configuredHmrPort,
    includeHmr: Boolean(environment.TAURI_DEV_HOST),
    allowFallback,
    probe,
  });
}

export function applyDevPortEnvironment(selection, environment = process.env) {
  environment.DATASET_STUDIO_FRONTEND_PORT = String(selection.frontendPort);
  environment.DATASET_STUDIO_PORT = String(selection.apiPort);
  environment.VITE_API_BASE_URL = `http://${LOOPBACK_HOST}:${selection.apiPort}`;
  if (selection.hmrPort === null) {
    delete environment.DATASET_STUDIO_HMR_PORT;
  } else {
    environment.DATASET_STUDIO_HMR_PORT = String(selection.hmrPort);
  }
}

export function formatPortSelection(selection) {
  const hmr = selection.hmrPort === null ? "" : `，HMR ${selection.hmrPort}`;
  return `Vite ${selection.frontendPort}，API ${selection.apiPort}${hmr}`;
}

async function runCli() {
  const knownArguments = new Set(["--auto", "--json"]);
  const unknownArgument = process.argv
    .slice(2)
    .find((argument) => !knownArguments.has(argument));
  if (unknownArgument) {
    throw new DevPortSelectionError(`未知参数：${unknownArgument}`);
  }

  const selection = await selectDevPortsFromEnvironment(process.env, {
    forceAuto: process.argv.includes("--auto"),
  });
  if (process.argv.includes("--json")) {
    process.stdout.write(`${JSON.stringify(selection)}\n`);
  } else {
    process.stdout.write(
      `[Dataset Studio] 可用开发端口：${formatPortSelection(selection)}\n`,
    );
  }
}

const isMainModule =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) ===
    path.resolve(fileURLToPath(import.meta.url));

if (isMainModule) {
  runCli().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`错误：${message}\n`);
    process.exitCode = 1;
  });
}
