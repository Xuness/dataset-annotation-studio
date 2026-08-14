import { useEffect, useMemo, useState } from "react";
import {
  Check,
  ChevronRight,
  CircleAlert,
  Folder,
  FolderOpen,
  HardDrive,
  Search,
  X,
} from "lucide-react";

import type { AssetFolderSummary } from "../../../../src/shared/api/types";
import { Button } from "../../../shared/ui/Button";
import { ModalLayer } from "../../../shared/ui/ModalLayer";
import { Spinner } from "../../../shared/ui/Spinner";

interface ExportDirectoryRulesDialogProps {
  open: boolean;
  folders: AssetFolderSummary[];
  error: string | null;
  loading: boolean;
  scopeDescription: string;
  value: readonly string[];
  onClose: () => void;
  onApply: (paths: string[]) => void;
}

function ancestors(path: string): string[] {
  if (!path) return [];
  const parts = path.split("/");
  return parts.map((_, index) => parts.slice(0, index + 1).join("/"));
}

function mappedParent(path: string, merged: ReadonlySet<string>): string {
  const parts = path.split("/").slice(0, -1);
  const original: string[] = [];
  const retained: string[] = [];
  for (const part of parts) {
    original.push(part);
    if (!merged.has(original.join("/"))) retained.push(part);
  }
  return retained.join("/") || "导出根目录";
}

export function ExportDirectoryRulesDialog({
  open,
  folders,
  error,
  loading,
  scopeDescription,
  value,
  onClose,
  onApply,
}: ExportDirectoryRulesDialogProps) {
  const [draftPaths, setDraftPaths] = useState<Set<string>>(new Set());
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set([""]));
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!open) return;
    setDraftPaths(new Set(value));
    setExpandedPaths(new Set(["", ...value.flatMap(ancestors)]));
    setQuery("");
  }, [open, value]);

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

  const visibleFolders = useMemo(() => {
    const root = folders.find((folder) => folder.path === "");
    if (!root) return [];
    const normalizedQuery = query.trim().toLowerCase();
    const included = new Set<string>();
    if (normalizedQuery) {
      for (const folder of folders) {
        if (
          folder.path.toLowerCase().includes(normalizedQuery) ||
          folder.name.toLowerCase().includes(normalizedQuery)
        ) {
          included.add("");
          included.add(folder.path);
          for (const path of ancestors(folder.path)) included.add(path);
        }
      }
    }

    const result: Array<{ folder: AssetFolderSummary; depth: number }> = [];
    const visit = (folder: AssetFolderSummary, depth: number) => {
      if (normalizedQuery && !included.has(folder.path)) return;
      result.push({ folder, depth });
      if (!normalizedQuery && !expandedPaths.has(folder.path)) return;
      for (const child of childrenByParent.get(folder.path) ?? []) visit(child, depth + 1);
    };
    visit(root, 0);
    return result;
  }, [childrenByParent, expandedPaths, folders, query]);

  function toggleExpanded(path: string) {
    setExpandedPaths((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  function toggleRule(path: string) {
    setDraftPaths((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  function apply() {
    const order = new Map(folders.map((folder, index) => [folder.path, index]));
    onApply(
      [...draftPaths].sort(
        (left, right) =>
          (order.get(left) ?? Number.MAX_SAFE_INTEGER) -
          (order.get(right) ?? Number.MAX_SAFE_INTEGER),
      ),
    );
  }

  return (
    <ModalLayer
      open={open}
      onClose={onClose}
      backdropClassName="export-directory-dialog-backdrop"
      panelClassName="export-directory-dialog"
      labelledBy="export-directory-dialog-title"
      initialFocusSelector="[data-export-directory-close]"
    >
      <header>
        <div>
          <span className="eyebrow">Directory projection</span>
          <h2 id="export-directory-dialog-title">自定义目录结构</h2>
        </div>
        <button type="button" data-export-directory-close="" aria-label="关闭" onClick={onClose}>
          <X size={17} />
        </button>
      </header>

      <div className="export-directory-dialog__intro">
        <p>从保留原目录结构开始，勾选需要移除并将内容上提一级的目录。</p>
        <small>
          目录树仅统计{scopeDescription}；只移除被勾选的目录层级，未勾选的层级继续保留。
        </small>
      </div>

      <div className="export-directory-dialog__toolbar">
        <label>
          <Search size={14} />
          <input
            value={query}
            aria-label="搜索目录"
            placeholder="搜索目录路径"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <span>已选择 {draftPaths.size} 个目录</span>
        <button type="button" disabled={!draftPaths.size} onClick={() => setDraftPaths(new Set())}>
          清除
        </button>
      </div>

      <div className="export-directory-dialog__body">
        {loading ? (
          <div className="export-directory-dialog__empty">
            <Spinner label="读取目录" />
          </div>
        ) : error ? (
          <div className="export-directory-dialog__empty" role="alert">
            <CircleAlert size={22} />
            <p>{error}</p>
          </div>
        ) : visibleFolders.length ? (
          <div className="export-directory-tree" role="tree" aria-label="导出目录规则">
            {visibleFolders.map(({ folder, depth }) => {
              const children = childrenByParent.get(folder.path) ?? [];
              const expanded = Boolean(query.trim()) || expandedPaths.has(folder.path);
              const selected = draftPaths.has(folder.path);
              const FolderIcon = folder.path === "" ? HardDrive : expanded ? FolderOpen : Folder;
              return (
                <div
                  key={folder.path || "__workspace_root__"}
                  className={`export-directory-tree__row ${selected ? "is-selected" : ""}`}
                  style={{ "--export-folder-depth": depth } as React.CSSProperties}
                  role="treeitem"
                  aria-expanded={children.length ? expanded : undefined}
                >
                  <button
                    type="button"
                    className="export-directory-tree__toggle"
                    aria-label={`${expanded ? "折叠" : "展开"} ${folder.name}`}
                    disabled={!children.length || Boolean(query.trim())}
                    onClick={() => toggleExpanded(folder.path)}
                  >
                    {children.length ? (
                      <ChevronRight className={expanded ? "is-expanded" : ""} size={14} />
                    ) : null}
                  </button>
                  <FolderIcon size={15} />
                  <span className="export-directory-tree__name" title={folder.path || folder.name}>
                    <strong>{folder.name}</strong>
                    <small>
                      {folder.path
                        ? selected
                          ? `内容并入 ${mappedParent(folder.path, draftPaths)}`
                          : folder.path
                        : "工作区根目录不可继续上提"}
                    </small>
                  </span>
                  <span className="export-directory-tree__count">
                    {folder.descendant_asset_count} 张
                  </span>
                  {folder.path ? (
                    <label className="export-directory-tree__rule">
                      <input
                        type="checkbox"
                        checked={selected}
                        aria-label={`将 ${folder.path} 并入父级`}
                        onChange={() => toggleRule(folder.path)}
                      />
                      <span>{selected ? "已并入父级" : "并入父级"}</span>
                    </label>
                  ) : (
                    <span className="export-directory-tree__root-label">根目录</span>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="export-directory-dialog__empty">
            <Folder size={22} />
            <p>{query.trim() ? "没有匹配的目录。" : "当前导出范围没有可配置的子目录。"}</p>
          </div>
        )}
      </div>

      <p className="export-directory-dialog__notice">
        合并造成的同名文件、大小写冲突以及文件/目录冲突会在“校验并预览”阶段阻止导出。
      </p>

      <footer>
        <Button onClick={onClose}>取消</Button>
        <Button
          tone="primary"
          icon={<Check size={14} />}
          disabled={loading || Boolean(error)}
          onClick={apply}
        >
          应用规则
        </Button>
      </footer>
    </ModalLayer>
  );
}
