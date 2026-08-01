import { useEffect, useMemo } from "react";
import { ChevronRight, Folder, FolderOpen, HardDrive } from "lucide-react";

import type { AssetFolderSummary } from "../../../../src/shared/api/types";
import { Spinner } from "../../../shared/ui/Spinner";
import { folderTreeViewState } from "../workspaceViewState";

interface AssetFolderTreeProps {
  projectId: string;
  folders: AssetFolderSummary[];
  selectedPath: string;
  loading: boolean;
  onSelect: (path: string) => Promise<boolean>;
}

export function AssetFolderTree({
  projectId,
  folders,
  selectedPath,
  loading,
  onSelect,
}: AssetFolderTreeProps) {
  const { expandedPaths } = folderTreeViewState.useValue(projectId);
  const setExpandedPaths = (update: (current: ReadonlySet<string>) => ReadonlySet<string>) =>
    folderTreeViewState.patch(projectId, (current) => ({
      expandedPaths: update(current.expandedPaths),
    }));
  const childrenByParent = useMemo(() => {
    const children = new Map<string, AssetFolderSummary[]>();
    for (const folder of folders) {
      if (folder.parent_path === null) continue;
      const siblings = children.get(folder.parent_path) ?? [];
      siblings.push(folder);
      children.set(folder.parent_path, siblings);
    }
    return children;
  }, [folders]);

  useEffect(() => {
    if (!selectedPath) return;
    folderTreeViewState.patch(projectId, (current) => {
      const next = new Set(current.expandedPaths);
      const parts = selectedPath.split("/");
      for (let index = 1; index <= parts.length; index += 1) {
        next.add(parts.slice(0, index).join("/"));
      }
      return next.size === current.expandedPaths.size ? {} : { expandedPaths: next };
    });
  }, [projectId, selectedPath]);

  const visibleFolders = useMemo(() => {
    const root = folders.find((folder) => folder.path === "");
    if (!root) return [];
    const visible: Array<{ folder: AssetFolderSummary; depth: number }> = [];
    const visit = (folder: AssetFolderSummary, depth: number) => {
      visible.push({ folder, depth });
      if (!expandedPaths.has(folder.path)) return;
      for (const child of childrenByParent.get(folder.path) ?? []) visit(child, depth + 1);
    };
    visit(root, 0);
    return visible;
  }, [childrenByParent, expandedPaths, folders]);

  function toggle(path: string) {
    setExpandedPaths((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  return (
    <section className="asset-folder-tree" aria-label="工作区目录">
      <header>
        <span>工作区目录</span>
        <small>{Math.max(0, folders.length - 1)} 个子目录</small>
      </header>
      <div className="asset-folder-tree__list">
        {loading ? (
          <div className="asset-folder-tree__loading">
            <Spinner label="读取目录" />
          </div>
        ) : (
          visibleFolders.map(({ folder, depth }) => {
            const children = childrenByParent.get(folder.path) ?? [];
            const expanded = expandedPaths.has(folder.path);
            const selected = folder.path === selectedPath;
            const FolderIcon = folder.path === "" ? HardDrive : expanded ? FolderOpen : Folder;
            return (
              <div
                key={folder.path || "__workspace_root__"}
                className={`asset-folder-tree__row ${selected ? "is-selected" : ""}`}
                style={{ "--folder-depth": depth } as React.CSSProperties}
              >
                <button
                  type="button"
                  className="asset-folder-tree__toggle"
                  aria-label={`${expanded ? "折叠" : "展开"} ${folder.name}`}
                  disabled={!children.length}
                  onClick={() => toggle(folder.path)}
                >
                  {children.length ? (
                    <ChevronRight className={expanded ? "is-expanded" : ""} size={13} />
                  ) : null}
                </button>
                <button
                  type="button"
                  className="asset-folder-tree__select"
                  title={folder.path || folder.name}
                  onClick={() => void onSelect(folder.path)}
                >
                  <FolderIcon size={14} />
                  <span>{folder.name}</span>
                  <small>{folder.descendant_asset_count}</small>
                </button>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
