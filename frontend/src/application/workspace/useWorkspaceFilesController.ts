import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import {
  listOriginalFiles,
  previewRestore,
  executeRestore,
  previewRelocate,
  executeRelocate,
  detachWorkspace,
} from "../../features/workspaces/api";
import type { ApiOutput, ApiSchema } from "../../shared/api/schema";
import { pickExportFolder, pickWorkspaceFolder } from "../../shared/desktop/pickFolder";

export function useWorkspaceFilesController() {
  const client = useQueryClient();
  const [projectId, setProjectId] = useState<string | null>(null);
  const [files, setFiles] = useState<ApiOutput<"OriginalFile">[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [filter, setFilter] = useState("");
  const [fileKind, setFileKind] = useState<"all" | "image" | "annotation">("all");
  const [destinationKind, setDestinationKind] = useState<"source" | "directory">("directory");
  const [destinationPath, setDestinationPath] = useState("");
  const [allowReplace, setAllowReplace] = useState(false);
  const [preview, setPreview] = useState<ApiOutput<"RestorePreview"> | null>(null);
  const [relocation, setRelocation] = useState<ApiOutput<"RelocatePreview"> | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [detachPending, setDetachPending] = useState(false);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setMessage(null);
    try {
      await action();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  function invalidate() {
    setPreview(null);
  }
  function request(): ApiSchema<"RestoreRequest"> {
    return {
      backup_ids: selected,
      destination_kind: destinationKind,
      destination_path: destinationPath || null,
      allow_replace: allowReplace,
    };
  }

  return {
    projectId,
    files: files.filter(
      (file) =>
        file.source_relative_path.toLocaleLowerCase().includes(filter.toLocaleLowerCase()) &&
        (fileKind === "all" ||
          (fileKind === "image" ? file.role === "image" : file.role !== "image")),
    ),
    filter,
    setFilter,
    fileKind,
    setFileKind,
    selected,
    destinationKind,
    destinationPath,
    allowReplace,
    preview,
    relocation,
    busy,
    message,
    detachPending,
    open: async (id: string) => {
      setProjectId(id);
      setFiles([]);
      setFilter("");
      setFileKind("all");
      setDestinationKind("directory");
      setDestinationPath("");
      setSelected([]);
      setPreview(null);
      setRelocation(null);
      setDetachPending(false);
      setAllowReplace(false);
      await run(async () => {
        setFiles(await listOriginalFiles(id));
      });
    },
    close: () => {
      if (!busy) setProjectId(null);
    },
    toggle: (id: string) => {
      invalidate();
      setSelected((current) =>
        current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
      );
    },
    setDestinationKind: (kind: "source" | "directory") => {
      invalidate();
      setDestinationKind(kind);
      setAllowReplace(false);
    },
    setAllowReplace: (value: boolean) => {
      invalidate();
      setAllowReplace(value);
    },
    chooseDestination: () =>
      run(async () => {
        const path = await pickExportFolder();
        if (path) {
          invalidate();
          setDestinationPath(path);
        }
      }),
    previewRestore: () =>
      run(async () => {
        if (projectId) setPreview(await previewRestore(projectId, request()));
      }),
    restore: () =>
      run(async () => {
        if (!projectId || !preview) return;
        await executeRestore(projectId, {
          request: request(),
          preview_token: preview.preview_token,
        });
        setPreview(null);
        setAllowReplace(false);
        setMessage("所选原始文件已恢复。");
        await client.invalidateQueries();
      }),
    chooseRelocation: () =>
      run(async () => {
        const path = await pickWorkspaceFolder();
        if (path && projectId) setRelocation(await previewRelocate(projectId, path));
      }),
    relocate: () =>
      run(async () => {
        if (!projectId || !relocation) return;
        await executeRelocate(projectId, {
          request: { path: relocation.path },
          preview_token: relocation.preview_token,
        });
        setRelocation(null);
        setMessage("数据集关联已更新。");
        await client.invalidateQueries();
      }),
    requestDetach: () => setDetachPending(true),
    detach: () =>
      run(async () => {
        if (projectId) {
          await detachWorkspace(projectId);
          setDetachPending(false);
          setMessage("目录关联已解除，项目备份与历史已保留。");
          await client.invalidateQueries();
        }
      }),
  };
}

export type WorkspaceFilesController = ReturnType<typeof useWorkspaceFilesController>;
