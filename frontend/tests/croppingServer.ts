import { spawnPythonTestServer, stopPythonTestServer } from "./pythonTestServer";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

export interface CroppingServerInfo {
  base_url: string;
  project_id: string;
  source_directory: string;
}
export interface CroppingTestServer {
  info: CroppingServerInfo;
  stop: () => Promise<void>;
}
export async function startCroppingServer(): Promise<CroppingTestServer> {
  const root = resolve(process.cwd(), "..");
  const server = spawnPythonTestServer(root, `${root}/backend/tests/cropping_ui_server.py`);
  let output = "";
  let errors = "";
  server.stderr?.on("data", (data: Buffer) => {
    errors += data.toString();
  });
  const startup = new Promise<CroppingServerInfo>((resolveInfo, reject) => {
    server.once("error", reject);
    server.once("exit", (code) => reject(new Error(`Cropping server exited (${code}): ${errors}`)));
    server.stdout?.on("data", (data: Buffer) => {
      output += data.toString();
      const line = output.split("\n").find((item) => item.startsWith("CROPPING_UI "));
      if (!line) return;
      try {
        const info: CroppingServerInfo = JSON.parse(line.slice("CROPPING_UI ".length));
        if (
          ![info.base_url, info.project_id, info.source_directory].every(
            (value) => typeof value === "string" && value.length > 0,
          )
        )
          throw new Error("Invalid cropping server metadata");
        resolveInfo(info);
      } catch (error) {
        reject(error);
      }
    });
  });
  const deadline = new AbortController();
  try {
    const info = await Promise.race([
      startup,
      delay(20000, null, { signal: deadline.signal }).then(() => {
        throw new Error(`Cropping startup timeout: ${errors}`);
      }),
    ]);
    const health = await fetch(`${info.base_url}/health`);
    if (!health.ok) throw new Error(`Cropping health check failed: ${health.status}`);
    return { info, stop: () => stopPythonTestServer(server) };
  } catch (error) {
    await stopPythonTestServer(server);
    throw error;
  } finally {
    deadline.abort();
  }
}
