import {
  ArrowDown,
  ArrowUp,
  BookOpenText,
  CloudDownload,
  ExternalLink,
  FileInput,
  FolderInput,
  FolderOpen,
  HardDrive,
  ListRestart,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
  useTagDictionaryActions,
  useTagDictionaryLibrary,
} from "../../../../src/features/tagDictionaries/hooks";
import type { TagDictionaryInstallation } from "../../../../src/shared/api/types";
import { openExternalUrl } from "../../../../src/shared/desktop/openExternalUrl";
import { openLocalFolder } from "../../../../src/shared/desktop/openLocalFolder";
import {
  pickTagDictionaryFile,
  pickTagDictionaryFolder,
} from "../../../../src/shared/desktop/pickFolder";
import { isDesktopRuntime } from "../../../../src/shared/desktop/runtime";
import { formatBytes } from "../../../../src/shared/format/bytes";
import { SettingsSectionHeader } from "../../../shared/settings/components/SettingsSectionHeader";
import "../../../shared/settings/styles/tag-dictionary-settings.css";
import { Button } from "../../../shared/ui/Button";
import { confirmDialog } from "../../../shared/ui/dialogs";
import { Spinner } from "../../../shared/ui/Spinner";
import { TagDictionaryCorrectionPanel } from "../tagDictionaries/TagDictionaryCorrectionPanel";
import { TagDictionaryDownloadPanel } from "../tagDictionaries/TagDictionaryDownloadPanel";

type DictionaryTab = "library" | "online" | "corrections";

const STATUS_LABELS = {
  ready: "可用",
  missing: "目录缺失",
  invalid: "校验失败",
};

export function TagDictionarySettings({ onClose }: { onClose: () => void }) {
  const library = useTagDictionaryLibrary();
  const actions = useTagDictionaryActions();
  const [activeTab, setActiveTab] = useState<DictionaryTab>("library");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const selected = useMemo(
    () =>
      library.data?.installations.find((item) => item.id === selectedId) ??
      library.data?.installations[0] ??
      null,
    [library.data?.installations, selectedId],
  );

  useEffect(() => {
    if (selected && selected.id !== selectedId) setSelectedId(selected.id);
  }, [selected, selectedId]);

  async function run(action: () => Promise<unknown>, success: string) {
    setMessage(null);
    setError(null);
    try {
      await action();
      setMessage(success);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "本地 Tag 词典操作失败。");
    }
  }

  async function importSource(kind: "file" | "folder") {
    const path = kind === "file" ? await pickTagDictionaryFile() : await pickTagDictionaryFolder();
    if (!path) return;
    await run(() => actions.importLocal.mutateAsync({ path }), "词典已规范化导入到受管词典库。");
  }

  async function openManagedDirectory(path: string, success: string) {
    await run(() => openLocalFolder(path), success);
  }

  async function removeInstallation(installation: TagDictionaryInstallation) {
    const accepted = await confirmDialog(
      `将删除“${installation.name}”的受管副本和原始来源文件。全局修正词条会保留；由它生成的译文会显示为当前不匹配。`,
      {
        title: "删除本地 Tag 词典",
        tone: "danger",
        confirmLabel: "删除词典",
      },
    );
    if (!accepted) return;
    await run(
      () => actions.removeInstallation.mutateAsync(installation.id),
      "词典已删除，修正词条仍然保留。",
    );
    setSelectedId(null);
  }

  async function move(installation: TagDictionaryInstallation, offset: -1 | 1) {
    if (!library.data) return;
    const ids = library.data.installations.map((item) => item.id);
    const index = ids.indexOf(installation.id);
    const target = index + offset;
    if (index < 0 || target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    await run(
      () => actions.reorder.mutateAsync(ids),
      "词典优先级已更新；受影响的译文会要求重新生成。",
    );
  }

  const busy =
    actions.importLocal.isPending ||
    actions.updateInstallation.isPending ||
    actions.reorder.isPending ||
    actions.removeInstallation.isPending;

  return (
    <>
      <SettingsSectionHeader
        eyebrow="Local dictionary"
        title="本地 Tag 词典"
        description={
          activeTab === "library"
            ? "词典文件集中保存在仓库根目录 dictionaries；各项目共享，译文按项目独立保存。"
            : activeTab === "online"
              ? "审核来源、版本与许可证状态后下载；授权不明确的词典只提供手动导入。"
              : "词典内容只读，通过全局修正词条覆盖错误或不合适的译法。"
        }
        actions={
          activeTab === "library" ? (
            <>
              <Button
                icon={<FolderInput size={14} />}
                disabled={busy}
                onClick={() => void importSource("folder")}
              >
                导入目录
              </Button>
              <Button
                tone="primary"
                icon={actions.importLocal.isPending ? <Spinner /> : <FileInput size={14} />}
                disabled={busy}
                onClick={() => void importSource("file")}
              >
                导入词典文件
              </Button>
            </>
          ) : undefined
        }
        onClose={onClose}
      />

      <div className="dictionary-settings-shell">
        <nav className="dictionary-settings-tabs" role="tablist" aria-label="本地 Tag 词典设置">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "library"}
            className={activeTab === "library" ? "is-active" : ""}
            onClick={() => setActiveTab("library")}
          >
            <HardDrive size={14} /> 词典库
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "online"}
            className={activeTab === "online" ? "is-active" : ""}
            onClick={() => setActiveTab("online")}
          >
            <CloudDownload size={14} /> 在线目录
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "corrections"}
            className={activeTab === "corrections" ? "is-active" : ""}
            onClick={() => setActiveTab("corrections")}
          >
            <ListRestart size={14} /> 词条修正
          </button>
        </nav>

        <div className="dictionary-settings" role="tabpanel">
          {activeTab === "online" ? (
            <TagDictionaryDownloadPanel />
          ) : activeTab === "corrections" ? (
            <TagDictionaryCorrectionPanel />
          ) : library.isLoading ? (
            <div className="dictionary-settings__loading">
              <Spinner label="读取本地 Tag 词典库" />
            </div>
          ) : library.isError || !library.data ? (
            <div className="dictionary-settings__loading">
              <p className="form-error">
                {library.error instanceof Error ? library.error.message : "无法读取词典库。"}
              </p>
            </div>
          ) : (
            <>
              <section className="dictionary-library-location">
                <span>
                  <BookOpenText size={18} />
                </span>
                <div>
                  <small>受管词典库</small>
                  <code title={library.data.dictionary_root}>{library.data.dictionary_root}</code>
                  <p>
                    {library.data.installations.length} 个安装 ·{" "}
                    {library.data.entry_count.toLocaleString()} 个启用词条 ·{" "}
                    {library.data.override_count.toLocaleString()} 个修正 ·{" "}
                    {formatBytes(library.data.disk_size)}
                  </p>
                </div>
                <Button
                  icon={<FolderOpen size={13} />}
                  disabled={!isDesktopRuntime()}
                  onClick={() =>
                    void openManagedDirectory(
                      library.data.dictionary_root,
                      "已打开受管词典库目录。",
                    )
                  }
                >
                  打开目录
                </Button>
              </section>

              {library.data.scan_issues.length ? (
                <div className="dictionary-scan-issues">
                  {library.data.scan_issues.map((issue) => (
                    <p key={issue}>{issue}</p>
                  ))}
                </div>
              ) : null}

              <div className="dictionary-manager-grid">
                <section className="dictionary-installation-list">
                  <header>
                    <div>
                      <span className="eyebrow">Priority order</span>
                      <h3>词典优先级</h3>
                    </div>
                    <small>越靠前越优先</small>
                  </header>
                  <div>
                    {library.data.installations.map((installation) => (
                      <button
                        type="button"
                        key={installation.id}
                        className={selected?.id === installation.id ? "is-active" : ""}
                        onClick={() => setSelectedId(installation.id)}
                      >
                        <span
                          className={`dictionary-status dictionary-status--${installation.status}`}
                        >
                          {STATUS_LABELS[installation.status]}
                          {!installation.enabled ? " · 已停用" : ""}
                        </span>
                        <strong>{installation.name}</strong>
                        <small>
                          {installation.entry_count.toLocaleString()} 词条 ·{" "}
                          {installation.source_version}
                        </small>
                      </button>
                    ))}
                    {!library.data.installations.length ? (
                      <p className="dictionary-empty">
                        尚未安装词典。可以导入文件，或在“在线目录”选择来源。
                      </p>
                    ) : null}
                  </div>
                </section>

                <section className="dictionary-installation-detail">
                  {selected ? (
                    <>
                      <header>
                        <div>
                          <span className="eyebrow">Installation</span>
                          <h3>{selected.name}</h3>
                          <p>
                            {selected.adapter_id} · {selected.language}
                          </p>
                        </div>
                        <label className="dictionary-enabled-toggle">
                          <input
                            type="checkbox"
                            checked={selected.enabled}
                            disabled={busy || selected.status !== "ready"}
                            onChange={(event) =>
                              void run(
                                () =>
                                  actions.updateInstallation.mutateAsync({
                                    id: selected.id,
                                    input: { enabled: event.target.checked },
                                  }),
                                event.target.checked ? "词典已启用。" : "词典已停用。",
                              )
                            }
                          />
                          参与查询
                        </label>
                      </header>
                      {selected.issue ? (
                        <p className="dictionary-inline-warning">{selected.issue}</p>
                      ) : null}
                      <dl>
                        <div>
                          <dt>词条数</dt>
                          <dd>{selected.entry_count.toLocaleString()}</dd>
                        </div>
                        <div>
                          <dt>磁盘占用</dt>
                          <dd>{formatBytes(selected.disk_size)}</dd>
                        </div>
                        <div>
                          <dt>许可证</dt>
                          <dd>{selected.license_id}</dd>
                        </div>
                        <div>
                          <dt>指纹</dt>
                          <dd title={selected.fingerprint}>{selected.fingerprint.slice(0, 12)}…</dd>
                        </div>
                      </dl>
                      <p className="dictionary-source-path" title={selected.path}>
                        {selected.path}
                      </p>
                      <footer>
                        <div>
                          <Button
                            icon={<ArrowUp size={13} />}
                            disabled={busy || selected.priority === 0}
                            onClick={() => void move(selected, -1)}
                          >
                            上移
                          </Button>
                          <Button
                            icon={<ArrowDown size={13} />}
                            disabled={
                              busy || selected.priority === library.data.installations.length - 1
                            }
                            onClick={() => void move(selected, 1)}
                          >
                            下移
                          </Button>
                        </div>
                        <div>
                          <Button
                            icon={<ExternalLink size={13} />}
                            onClick={() => void openExternalUrl(selected.license_url)}
                          >
                            授权
                          </Button>
                          <Button
                            icon={<FolderOpen size={13} />}
                            disabled={!isDesktopRuntime()}
                            onClick={() =>
                              void openManagedDirectory(selected.path, "已打开词典安装目录。")
                            }
                          >
                            文件
                          </Button>
                          <Button
                            tone="danger"
                            icon={<Trash2 size={13} />}
                            disabled={busy}
                            onClick={() => void removeInstallation(selected)}
                          >
                            删除
                          </Button>
                        </div>
                      </footer>
                    </>
                  ) : (
                    <p className="dictionary-empty">选择一个词典安装查看详情。</p>
                  )}
                </section>
              </div>

              <section className="dictionary-adapters">
                <header>
                  <div>
                    <span className="eyebrow">Import adapters</span>
                    <h3>支持的本地格式</h3>
                  </div>
                </header>
                <div>
                  {library.data.supported_adapters.map((adapter) => (
                    <article key={adapter.id}>
                      <strong>{adapter.name}</strong>
                      <span>{adapter.description}</span>
                      <small>{adapter.accepted_inputs.join(" · ")}</small>
                    </article>
                  ))}
                </div>
              </section>
            </>
          )}

          {message ? <p className="dictionary-action-message">{message}</p> : null}
          {error ? <p className="form-error">{error}</p> : null}
        </div>
      </div>
    </>
  );
}
