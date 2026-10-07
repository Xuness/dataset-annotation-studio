import { spawnPythonTestServer, stopPythonTestServer } from "./pythonTestServer";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

export interface CharacterAuditServerInfo {
  base_url: string;
  project_id: string;
  review_id: string;
  draft_id: string;
  provider_id: string;
  reference_id: string;
  vocabulary_id: string;
  source_directory: string;
}
export interface CharacterAuditTestServer {
  info: CharacterAuditServerInfo;
  stop(): Promise<void>;
}

export async function startCharacterAuditServer(): Promise<CharacterAuditTestServer> {
  const root = resolve(process.cwd(), "..");
  const server = spawnPythonTestServer(root, `${root}/backend/tests/character_audit_ui_server.py`);
  let output = "";
  let errors = "";
  server.stderr?.on("data", (data: Buffer) => {
    errors += data.toString();
  });
  const startup = new Promise<CharacterAuditServerInfo>((resolve, reject) => {
    server.once("error", reject);
    server.once("exit", (code) =>
      reject(new Error(`Audit test server exited (${code}): ${errors}`)),
    );
    server.stdout?.on("data", (data: Buffer) => {
      output += data.toString();
      const line = output.split("\n").find((item) => item.startsWith("CHARACTER_AUDIT_UI "));
      if (!line) return;
      try {
        const info: CharacterAuditServerInfo = JSON.parse(line.slice("CHARACTER_AUDIT_UI ".length));
        if (
          ![
            info.base_url,
            info.project_id,
            info.review_id,
            info.draft_id,
            info.provider_id,
            info.reference_id,
            info.vocabulary_id,
            info.source_directory,
          ].every((item) => typeof item === "string" && item.length > 0)
        )
          throw new Error("Invalid audit test server metadata");
        resolve(info);
      } catch (error) {
        reject(error);
      }
    });
  });
  const deadline = new AbortController();
  try {
    const info = await Promise.race([
      startup,
      delay(20_000, null, { signal: deadline.signal }).then(() => {
        throw new Error(`Audit server startup timeout: ${errors}`);
      }),
    ]);
    return { info, stop: () => stopPythonTestServer(server) };
  } catch (error) {
    await stopPythonTestServer(server);
    throw error;
  } finally {
    deadline.abort();
  }
}
