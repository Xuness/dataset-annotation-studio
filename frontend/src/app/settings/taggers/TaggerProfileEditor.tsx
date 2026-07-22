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
  const [concurrency, setConcurrency] = useState(profile.concurrency);
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
    setConcurrency(profile.concurrency);
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
    concurrency !== profile.concurrency ||
    [...categories].sort().join("\0") !== [...profile.categories].sort().join("\0");
  const valid = Boolean(name.trim() && selectedInstallation && categories.length);

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
          <span>并发图片数</span>
          <input
            type="number"
            min="1"
            max="8"
            step="1"
            value={concurrency}
            onChange={(event) => setConcurrency(Number(event.target.value))}
          />
          <small>大型模型建议从 1 开始。</small>
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
              concurrency,
            })
          }
        >
          保存配置
        </Button>
      </footer>
    </section>
  );
}
