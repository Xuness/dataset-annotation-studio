import { execFile, spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";

export function spawnPythonTestServer(root: string, script: string): ChildProcess {
  return spawn("uv", ["run", "--project", `${root}/backend`, "--no-sync", "python", script], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
    detached: process.platform !== "win32",
    windowsHide: true,
  });
}

async function terminateTree(server: ChildProcess, signal: "SIGTERM" | "SIGKILL") {
  if (!server.pid || server.exitCode !== null || server.signalCode !== null) return;
  if (process.platform === "win32") {
    // uv and the Windows virtualenv launcher each create a child Python process.
    await new Promise<void>((resolve, reject) => {
      execFile(
        "taskkill",
        ["/PID", String(server.pid), "/T", "/F"],
        { windowsHide: true },
        (error) => {
          if (error && server.exitCode === null && server.signalCode === null) reject(error);
          else resolve();
        },
      );
    });
  } else {
    process.kill(-server.pid, signal);
  }
}

export async function stopPythonTestServer(server: ChildProcess): Promise<void> {
  if (server.exitCode !== null || server.signalCode !== null || !server.pid) return;
  const exited = once(server, "exit");
  const deadline = new AbortController();
  try {
    await terminateTree(server, "SIGTERM");
    await Promise.race([
      exited,
      delay(5000, null, { signal: deadline.signal }).then(async () => {
        await terminateTree(server, "SIGKILL");
        throw new Error("Python test server did not terminate");
      }),
    ]);
  } finally {
    deadline.abort();
  }
}
