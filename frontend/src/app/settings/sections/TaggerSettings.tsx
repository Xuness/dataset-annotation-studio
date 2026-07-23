import { isTauri } from "@tauri-apps/api/core";
import {
  CheckCircle2,
  CloudDownload,
  FolderInput,
  FolderOpen,
  HardDrive,
  Plus,
  RefreshCw,
  ScanSearch,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { useTaggerActions, useTaggerLibrary } from "../../../features/taggers/hooks";
import { taggerSelectionModeLabel } from "../../../features/taggers/labels";
import { openLocalFolder } from "../../../shared/desktop/openLocalFolder";
import { pickTaggerLibraryFolder, pickTaggerModelFolder } from "../../../shared/desktop/pickFolder";
import { formatBytes } from "../../../shared/format/bytes";
import { SettingsSectionHeader } from "../../../shared/settings/components/SettingsSectionHeader";
import "../../../shared/settings/styles/tagger-settings.css";
import { Button } from "../../../shared/ui/Button";
import { confirmDialog } from "../../../shared/ui/dialogs";
import { Spinner } from "../../../shared/ui/Spinner";
import { TaggerDownloadPanel } from "../taggers/TaggerDownloadPanel";
import { TaggerProfileEditor } from "../taggers/TaggerProfileEditor";

const STATUS_LABELS = {
  ready: "校验通过",
  invalid: "需要处理",
  missing: "目录缺失",
};

export function TaggerSettings({ onClose }: { onClose: () => void }) {
  const library = useTaggerLibrary();
  const actions = useTaggerActions();
  const [selectedInstallationId, setSelectedInstallationId] = useState<string | null>(null);
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"library" | "downloads">("library");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const data = library.data;
  const selectedInstallation = useMemo(
    () =>
      data?.installations.find((item) => item.id === selectedInstallationId) ??
      data?.installations[0] ??
      null,
    [data?.installations, selectedInstallationId],
  );
  const selectedProfile = useMemo(
    () =>
      data?.profiles.find((item) => item.id === selectedProfileId) ??
      data?.profiles.find((item) => item.installation_id === selectedInstallation?.id) ??
      null,
    [data?.profiles, selectedInstallation?.id, selectedProfileId],
  );

  useEffect(() => {
    if (selectedInstallation && selectedInstallation.id !== selectedInstallationId) {
      setSelectedInstallationId(selectedInstallation.id);
    }
  }, [selectedInstallation, selectedInstallationId]);

  async function run(action: () => Promise<unknown>, success: string) {
    setError(null);
    setMessage(null);
    try {
      await action();
      setMessage(success);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "本地打标器操作失败。");
    }
  }

  async function importModel() {
    const path = await pickTaggerModelFolder();
    if (!path) return;
    await run(() => actions.importLocal.mutateAsync({ path }), "模型已导入并创建默认打标配置。");
  }

  async function chooseRoot() {
    const path = await pickTaggerLibraryFolder();
    if (!path) return;
    await run(() => actions.setRoot.mutateAsync(path), "模型库位置已更新。");
  }

  async function openFolder(path: string) {
    await run(() => openLocalFolder(path), "已打开本地目录。");
  }

  async function removeInstallation() {
    if (!selectedInstallation) return;
    const linkedProfiles = data?.profiles.filter(
      (profile) => profile.installation_id === selectedInstallation.id,
    ).length;
    const confirmed = await confirmDialog(
      `将删除“${selectedInstallation.name}”的受管模型文件及 ${linkedProfiles ?? 0} 个关联配置。历史任务记录仍会保留，但不能再继续执行。`,
      {
        title: "删除本地打标器",
        tone: "danger",
        confirmLabel: "删除模型与配置",
      },
    );
    if (!confirmed) return;
    await run(
      () => actions.removeInstallation.mutateAsync(selectedInstallation.id),
      "本地打标器已删除。",
    );
    setSelectedInstallationId(null);
    setSelectedProfileId(null);
  }

  async function createProfile() {
    if (!selectedInstallation) return;
    const count = (data?.profiles ?? []).filter(
      (profile) => profile.installation_id === selectedInstallation.id,
    ).length;
    const existingNames = new Set(
      (data?.profiles ?? []).map((profile) => profile.name.toLocaleLowerCase()),
    );
    let suffix = count + 1;
    let name = `${selectedInstallation.name} 配置 ${suffix}`;
    while (existingNames.has(name.toLocaleLowerCase())) {
      suffix += 1;
      name = `${selectedInstallation.name} 配置 ${suffix}`;
    }
    await run(async () => {
      const profile = await actions.createProfile.mutateAsync({
        name,
        installation_id: selectedInstallation.id,
        selection: selectedInstallation.profile_capabilities.default_selection,
        categories: selectedInstallation.profile_capabilities.default_categories,
        device: "auto",
        batch_size: null,
      });
      setSelectedProfileId(profile.id);
    }, "已创建新的打标配置。");
  }

  async function removeProfile() {
    if (!selectedProfile) return;
    const confirmed = await confirmDialog(`确定删除打标配置“${selectedProfile.name}”吗？`, {
      title: "删除打标配置",
      tone: "danger",
      confirmLabel: "删除配置",
    });
    if (!confirmed) return;
    await run(() => actions.removeProfile.mutateAsync(selectedProfile.id), "打标配置已删除。");
    setSelectedProfileId(null);
  }

  const busy =
    actions.importLocal.isPending ||
    actions.rescan.isPending ||
    actions.validate.isPending ||
    actions.removeInstallation.isPending;

  return (
    <>
      <SettingsSectionHeader
        eyebrow="Local inference"
        title="本地打标器"
        description={
          activeTab === "library"
            ? "集中管理本机模型文件与可复用打标配置；模型不会写入数据集项目。"
            : "从经过审核的固定 Hugging Face revision 下载、校验并安装模型。"
        }
        actions={
          activeTab === "library" ? (
            <>
              <Button
                icon={actions.rescan.isPending ? <Spinner /> : <ScanSearch size={14} />}
                disabled={busy}
                onClick={() => void run(() => actions.rescan.mutateAsync(), "模型库扫描完成。")}
              >
                重新扫描
              </Button>
              <Button
                tone="primary"
                icon={actions.importLocal.isPending ? <Spinner /> : <FolderInput size={14} />}
                disabled={busy}
                onClick={() => void importModel()}
              >
                导入本地模型
              </Button>
            </>
          ) : undefined
        }
        onClose={onClose}
      />

      <div className="tagger-settings-shell">
        <nav className="tagger-settings-tabs" role="tablist" aria-label="本地打标器设置">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "library"}
            className={activeTab === "library" ? "is-active" : ""}
            onClick={() => setActiveTab("library")}
          >
            <HardDrive size={14} />
            模型库
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "downloads"}
            className={activeTab === "downloads" ? "is-active" : ""}
            onClick={() => setActiveTab("downloads")}
          >
            <CloudDownload size={14} />
            Hugging Face 下载
          </button>
        </nav>

        {activeTab === "library" ? (
          <div className="tagger-settings" role="tabpanel">
            {library.isLoading ? (
              <div className="tagger-settings__loading">
                <Spinner label="读取本地打标器模型库" />
              </div>
            ) : library.isError || !data ? (
              <div className="tagger-settings__loading">
                <p className="form-error">
                  {library.error instanceof Error ? library.error.message : "无法读取模型库。"}
                </p>
              </div>
            ) : (
              <>
                <section className="tagger-library-location">
                  <span aria-hidden="true">
                    <HardDrive size={18} />
                  </span>
                  <div>
                    <small>受管模型库</small>
                    <code title={data.model_root}>{data.model_root}</code>
                    <p>
                      {data.installations.length} 个模型 · {data.profiles.length} 个配置 ·{" "}
                      {formatBytes(data.disk_size)}
                    </p>
                  </div>
                  <div>
                    <Button
                      icon={<FolderOpen size={13} />}
                      disabled={!isTauri()}
                      onClick={() => void openFolder(data.model_root)}
                    >
                      打开目录
                    </Button>
                    <Button
                      icon={<RefreshCw size={13} />}
                      disabled={Boolean(data.installations.length)}
                      title={data.installations.length ? "模型库非空时不能直接切换位置" : undefined}
                      onClick={() => void chooseRoot()}
                    >
                      更改位置
                    </Button>
                  </div>
                </section>

                <section
                  className={`tagger-runtime-status ${data.runtime.available ? "is-ready" : "is-error"}`}
                >
                  {data.runtime.available ? <CheckCircle2 size={16} /> : <HardDrive size={16} />}
                  <div>
                    <strong>
                      {data.runtime.available ? "ONNX Runtime 已就绪" : "本地推理运行时不可用"}
                    </strong>
                    <span>
                      {data.runtime.available
                        ? data.runtime.providers.join(" · ")
                        : data.runtime.error}
                    </span>
                  </div>
                </section>

                {data.scan_issues.length ? (
                  <div className="tagger-scan-issues">
                    {data.scan_issues.map((issue) => (
                      <p key={issue}>{issue}</p>
                    ))}
                  </div>
                ) : null}

                <div className="tagger-manager-grid">
                  <section className="tagger-installation-list">
                    <header>
                      <div>
                        <span className="eyebrow">Model library</span>
                        <h3>模型安装</h3>
                      </div>
                      <small>{data.installations.length}</small>
                    </header>
                    <div>
                      {data.installations.map((installation) => (
                        <button
                          key={installation.id}
                          className={
                            selectedInstallation?.id === installation.id ? "is-active" : ""
                          }
                          onClick={() => {
                            setSelectedInstallationId(installation.id);
                            setSelectedProfileId(null);
                          }}
                        >
                          <span className={`tagger-status tagger-status--${installation.status}`}>
                            {STATUS_LABELS[installation.status]}
                          </span>
                          <strong>{installation.name}</strong>
                          <small>
                            {installation.adapter_name} · {installation.model_version}
                          </small>
                          <small>
                            {formatBytes(installation.disk_size)} ·{" "}
                            {installation.tag_count.toLocaleString()} 标签
                          </small>
                        </button>
                      ))}
                      {!data.installations.length ? (
                        <p className="tagger-empty-copy">
                          导入一个受支持的本地模型后，会在这里显示。
                        </p>
                      ) : null}
                    </div>
                  </section>

                  <section className="tagger-installation-detail">
                    {selectedInstallation ? (
                      <>
                        <header>
                          <div>
                            <span className="eyebrow">Installation</span>
                            <h3>{selectedInstallation.name}</h3>
                            <p>
                              {selectedInstallation.adapter_name} ·{" "}
                              {selectedInstallation.model_version}
                            </p>
                          </div>
                          <span
                            className={`tagger-status tagger-status--${selectedInstallation.status}`}
                          >
                            {STATUS_LABELS[selectedInstallation.status]}
                          </span>
                        </header>
                        {selectedInstallation.issues.map((issue) => (
                          <p className="tagger-inline-warning" key={issue}>
                            {issue}
                          </p>
                        ))}
                        {selectedInstallation.warnings.map((warning) => (
                          <p className="tagger-inline-warning" key={warning}>
                            {warning}
                          </p>
                        ))}
                        <dl>
                          <div>
                            <dt>标签总数</dt>
                            <dd>{selectedInstallation.tag_count.toLocaleString()}</dd>
                          </div>
                          <div>
                            <dt>磁盘占用</dt>
                            <dd>{formatBytes(selectedInstallation.disk_size)}</dd>
                          </div>
                          <div>
                            <dt>适配器</dt>
                            <dd>{selectedInstallation.adapter_id}</dd>
                          </div>
                          <div>
                            <dt>模型指纹</dt>
                            <dd title={selectedInstallation.fingerprint}>
                              {selectedInstallation.fingerprint.slice(0, 12)}…
                            </dd>
                          </div>
                        </dl>
                        <div className="tagger-file-list">
                          {selectedInstallation.files.map((file) => (
                            <span key={file.relative_path}>
                              <code>{file.relative_path}</code>
                              <small>{formatBytes(file.size)}</small>
                            </span>
                          ))}
                        </div>
                        <footer>
                          <Button
                            icon={<FolderOpen size={13} />}
                            disabled={!isTauri()}
                            onClick={() => void openFolder(selectedInstallation.path)}
                          >
                            查看文件
                          </Button>
                          <Button
                            icon={
                              actions.validate.isPending ? <Spinner /> : <RefreshCw size={13} />
                            }
                            disabled={busy}
                            onClick={() =>
                              void run(
                                () => actions.validate.mutateAsync(selectedInstallation.id),
                                "模型完整性校验完成。",
                              )
                            }
                          >
                            完整校验
                          </Button>
                          <Button
                            tone="danger"
                            icon={<Trash2 size={13} />}
                            disabled={busy}
                            onClick={() => void removeInstallation()}
                          >
                            删除模型
                          </Button>
                        </footer>
                      </>
                    ) : (
                      <p className="tagger-empty-copy">选择一个模型安装查看详情。</p>
                    )}
                  </section>
                </div>

                <section className="tagger-profiles">
                  <header>
                    <div>
                      <span className="eyebrow">Reusable profiles</span>
                      <h3>打标配置</h3>
                      <p>选择策略、标签类别、执行设备与批大小独立于模型文件，可由任务直接选择。</p>
                    </div>
                    <Button
                      icon={<Plus size={13} />}
                      disabled={!selectedInstallation || selectedInstallation.status !== "ready"}
                      onClick={() => void createProfile()}
                    >
                      新建配置
                    </Button>
                  </header>
                  <div className="tagger-profile-tabs">
                    {data.profiles.map((profile) => (
                      <button
                        key={profile.id}
                        className={selectedProfile?.id === profile.id ? "is-active" : ""}
                        onClick={() => {
                          setSelectedProfileId(profile.id);
                          setSelectedInstallationId(profile.installation_id);
                        }}
                      >
                        <strong>{profile.name}</strong>
                        <small>
                          {profile.ready
                            ? `${taggerSelectionModeLabel(profile.selection.mode)} · ${profile.selection.global_threshold.toFixed(2)}`
                            : "不可用"}
                        </small>
                      </button>
                    ))}
                  </div>
                  {selectedProfile ? (
                    <TaggerProfileEditor
                      profile={selectedProfile}
                      installations={data.installations.filter((item) => item.status === "ready")}
                      availableDevices={data.runtime.devices}
                      saving={actions.updateProfile.isPending}
                      onSave={(input) =>
                        run(
                          () =>
                            actions.updateProfile.mutateAsync({ id: selectedProfile.id, input }),
                          "打标配置已保存。",
                        )
                      }
                      onDelete={() => void removeProfile()}
                    />
                  ) : (
                    <p className="tagger-empty-copy">模型导入后会自动创建一份默认配置。</p>
                  )}
                </section>
              </>
            )}
            {message ? <p className="tagger-action-message">{message}</p> : null}
            {error ? <p className="form-error">{error}</p> : null}
          </div>
        ) : (
          <div className="tagger-settings" role="tabpanel">
            <TaggerDownloadPanel />
          </div>
        )}
      </div>

      <footer>
        <span>远程安装只接受内置审核计划，不支持任意仓库或自动猜测目录结构</span>
        <span>任务会保存模型指纹与完整配置快照</span>
      </footer>
    </>
  );
}
