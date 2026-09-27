import "./WorkspaceFilesDialog.css";
import { useEffect, useRef } from "react";
import type { WorkspaceFilesController } from "../../../../pages/spaces/spacePageModel";

export function WorkspaceFilesDialog({ controller: c }: { controller: WorkspaceFilesController }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (c.projectId && dialogRef.current && !dialogRef.current.open) dialogRef.current.showModal();
  }, [c.projectId]);
  if (!c.projectId) return null;
  return (
    <dialog
      ref={dialogRef}
      onCancel={(event) => {
        event.preventDefault();
        c.close();
      }}
      aria-label="原始文件与目录关联"
      className="workspace-files-dialog"
    >
      <header>
        <h2>原始文件与目录关联</h2>
        <button id="workspace-files-close" type="button" onClick={c.close} disabled={c.busy}>
          关闭
        </button>
      </header>
      <p>取回工具首次修改前的备份，不删除后来生成的其他文件。</p>
      {c.message ? <p role="status">{c.message}</p> : null}
      <fieldset disabled={c.busy}>
        <legend>恢复原始文件</legend>
        <label>
          筛选文件{" "}
          <input
            id="original-file-filter"
            value={c.filter}
            onChange={(event) => c.setFilter(event.target.value)}
          />
        </label>
        <label>
          文件类型{" "}
          <select
            id="original-file-kind"
            value={c.fileKind}
            onChange={(event) =>
              c.setFileKind(event.target.value as "all" | "image" | "annotation")
            }
          >
            <option value="all">全部</option>
            <option value="image">图片</option>
            <option value="annotation">标注与伴随文件</option>
          </select>
        </label>
        {!c.files.length ? (
          <p>没有匹配的原始备份；工具首次修改文件前会保存可确认的原文件。</p>
        ) : null}
        <div style={{ maxHeight: 260, overflow: "auto" }}>
          {c.files.map((file) => (
            <label key={file.id} style={{ display: "block" }}>
              <input
                data-testid={`original-file-${file.id}`}
                type="checkbox"
                disabled={!file.available}
                checked={c.selected.includes(file.id)}
                onChange={() => c.toggle(file.id)}
              />
              {file.source_relative_path} · {file.byte_size.toLocaleString()} 字节 ·{" "}
              {new Date(file.created_at).toLocaleString()}
              {file.available ? "" : " · 备份缺失"}
            </label>
          ))}
        </div>
        <label>
          恢复位置{" "}
          <select
            id="restore-destination-kind"
            value={c.destinationKind}
            onChange={(event) => c.setDestinationKind(event.target.value as "source" | "directory")}
          >
            <option value="directory">指定文件夹</option>
            <option value="source">原始位置</option>
          </select>
        </label>
        {c.destinationKind === "directory" ? (
          <button
            id="restore-choose-directory"
            type="button"
            onClick={() => void c.chooseDestination()}
          >
            {c.destinationPath || "选择恢复文件夹"}
          </button>
        ) : (
          <label>
            <input
              id="restore-allow-replace"
              type="checkbox"
              checked={c.allowReplace}
              onChange={(event) => c.setAllowReplace(event.target.checked)}
            />
            允许先备份当前文件再覆盖
          </label>
        )}
        <button
          id="restore-preview"
          type="button"
          disabled={!c.selected.length}
          onClick={() => void c.previewRestore()}
        >
          预览恢复
        </button>
        {c.preview ? (
          <section>
            {c.preview.items.map((item) => (
              <p key={item.backup.id}>
                {
                  {
                    create: "新建",
                    reuse: "内容相同，复用",
                    replace: "备份当前文件后覆盖",
                    blocked: "存在冲突",
                  }[item.action]
                }{" "}
                · {item.target_path}
              </p>
            ))}
            {c.preview.blocking_issues.map((issue) => (
              <p key={issue} role="alert">
                {issue}
              </p>
            ))}
            <button
              id="restore-execute"
              type="button"
              disabled={Boolean(c.preview.blocking_issues.length)}
              onClick={() => void c.restore()}
            >
              确认恢复所选文件
            </button>
          </section>
        ) : null}
      </fieldset>
      <fieldset disabled={c.busy}>
        <legend>数据集目录关联</legend>
        <button id="workspace-relocate" type="button" onClick={() => void c.chooseRelocation()}>
          重新定位数据集
        </button>
        {c.relocation ? (
          <section>
            <p>{c.relocation.path}</p>
            <p>
              匹配 {c.relocation.matched}，变化 {c.relocation.changed}，缺失 {c.relocation.missing}
            </p>
            <button id="workspace-relocate-confirm" type="button" onClick={() => void c.relocate()}>
              确认关联到此目录
            </button>
          </section>
        ) : null}
        <button id="workspace-detach" type="button" onClick={c.requestDetach}>
          解除目录关联
        </button>
        {c.detachPending ? (
          <p>
            仅解除目录归属，工作区备份与历史保留，继续操作该项目需要重新关联。
            <button id="workspace-detach-confirm" type="button" onClick={() => void c.detach()}>
              确认解除关联
            </button>
          </p>
        ) : null}
      </fieldset>
    </dialog>
  );
}
