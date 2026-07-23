import { Save, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import type {
  TaggerDevice,
  TaggerInstallation,
  TaggerProfile,
  TaggerProfileInput,
} from "../../../shared/api/types";
import { Button } from "../../../shared/ui/Button";
import { Spinner } from "../../../shared/ui/Spinner";

const CATEGORY_LABELS: Record<string, string> = {
  character: "角色",
  general: "通用",
  copyright: "作品",
  meta: "元信息",
  rating: "分级",
  quality: "质量",
  unknown: "其它",
};

const DEVICE_LABELS: Record<TaggerDevice, string> = {
  auto: "自动选择",
  cpu: "CPU",
  cuda: "NVIDIA CUDA",
  directml: "DirectML",
};

export function TaggerProfileEditor({
  profile,
  installations,
  availableDevices,
  saving,
  onSave,
  onDelete,
}: {
  profile: TaggerProfile;
  installations: TaggerInstallation[];
  availableDevices: TaggerDevice[];
  saving: boolean;
  onSave: (input: TaggerProfileInput) => Promise<void>;
  onDelete: () => void;
}) {
  const [name, setName] = useState(profile.name);
  const [installationId, setInstallationId] = useState(profile.installation_id);
  const [threshold, setThreshold] = useState(profile.threshold);
  const [categories, setCategories] = useState(profile.categories);
  const [device, setDevice] = useState(profile.device);
  const [batchSize, setBatchSize] = useState<number | null>(profile.batch_size);
  const selectedInstallation = useMemo(
    () => installations.find((item) => item.id === installationId) ?? null,
    [installationId, installations],
  );

  useEffect(() => {
    setName(profile.name);
    setInstallationId(profile.installation_id);
    setThreshold(profile.threshold);
    setCategories(profile.categories);
    setDevice(profile.device);
    setBatchSize(profile.batch_size);
  }, [profile]);

  function changeInstallation(nextId: string) {
    setInstallationId(nextId);
    const installation = installations.find((item) => item.id === nextId);
    setCategories(installation ? Object.keys(installation.categories) : []);
  }

  function toggleCategory(category: string) {
    setCategories((current) =>
      current.includes(category)
        ? current.filter((item) => item !== category)
        : [...current, category],
    );
  }

  const dirty =
    name !== profile.name ||
    installationId !== profile.installation_id ||
    threshold !== profile.threshold ||
    device !== profile.device ||
    batchSize !== profile.batch_size ||
    [...categories].sort().join("\0") !== [...profile.categories].sort().join("\0");
  const valid = Boolean(
    name.trim() &&
    selectedInstallation &&
    categories.length &&
    (batchSize === null || (Number.isInteger(batchSize) && batchSize >= 1 && batchSize <= 32)),
  );

  return (
    <section className="tagger-profile-editor">
      <header>
        <div>
          <span className="eyebrow">Execution profile</span>
          <h3>{profile.name}</h3>
        </div>
        <span className={`tagger-status tagger-status--${profile.ready ? "ready" : "invalid"}`}>
          {profile.ready ? "可用于任务" : "当前不可用"}
        </span>
      </header>

      {profile.issue ? <p className="tagger-inline-warning">{profile.issue}</p> : null}

      <div className="tagger-profile-grid">
        <label className="form-field form-field--wide">
          <span>配置名称</span>
          <input value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <label className="form-field form-field--wide">
          <span>模型安装</span>
          <select
            value={installationId}
            onChange={(event) => changeInstallation(event.target.value)}
          >
            {installations.map((installation) => (
              <option key={installation.id} value={installation.id}>
                {installation.name} · {installation.model_version}
              </option>
            ))}
          </select>
        </label>
        <label className="form-field">
          <span>统一阈值</span>
          <input
            type="number"
            min="0.01"
            max="0.99"
            step="0.01"
            value={threshold}
            onChange={(event) => setThreshold(Number(event.target.value))}
          />
          <small>CL Tagger v2 推荐 0.55。</small>
        </label>
        <label className="form-field">
          <span>推理批大小</span>
          <select
            value={batchSize === null ? "auto" : "manual"}
            onChange={(event) => setBatchSize(event.target.value === "auto" ? null : 4)}
          >
            <option value="auto">自动（推荐）</option>
            <option value="manual">手动指定</option>
          </select>
          {batchSize !== null ? (
            <input
              aria-label="手动推理批大小"
              type="number"
              min="1"
              max="32"
              step="1"
              value={batchSize}
              onChange={(event) => setBatchSize(Number(event.target.value))}
            />
          ) : null}
          <small>自动模式会按模型与设备选择，并在失败时缩小批次。</small>
        </label>
        <label className="form-field form-field--wide">
          <span>执行设备</span>
          <select
            value={device}
            onChange={(event) => setDevice(event.target.value as TaggerDevice)}
          >
            {Array.from(new Set<TaggerDevice>([...availableDevices, profile.device])).map(
              (item) => (
                <option key={item} value={item}>
                  {DEVICE_LABELS[item]}
                  {!availableDevices.includes(item) ? " · 当前运行时不可用" : ""}
                </option>
              ),
            )}
          </select>
        </label>
      </div>

      <fieldset className="tagger-category-options">
        <legend>输出类别</legend>
        {Object.entries(selectedInstallation?.categories ?? {}).map(([category, count]) => (
          <label key={category}>
            <input
              type="checkbox"
              checked={categories.includes(category)}
              onChange={() => toggleCategory(category)}
            />
            <span>{CATEGORY_LABELS[category] ?? category}</span>
            <small>{count.toLocaleString()}</small>
          </label>
        ))}
      </fieldset>

      <footer>
        <Button tone="danger" icon={<Trash2 size={13} />} onClick={onDelete}>
          删除配置
        </Button>
        <Button
          tone="primary"
          icon={saving ? <Spinner /> : <Save size={13} />}
          disabled={!dirty || !valid || saving}
          onClick={() =>
            void onSave({
              name: name.trim(),
              installation_id: installationId,
              threshold,
              categories,
              device,
              batch_size: batchSize,
            })
          }
        >
          保存配置
        </Button>
      </footer>
    </section>
  );
}
