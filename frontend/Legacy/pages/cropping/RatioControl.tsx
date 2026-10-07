import { useEffect, useRef, useState } from "react";
import { ArrowLeftRight, Plus, Save, Trash2 } from "lucide-react";

import { validateRatio } from "../../../src/application/cropping/geometry";
import { useRatioPresets } from "../../../src/application/cropping/useRatioPresets";
import type { Ratio } from "../../../src/shared/api/types";
import { Button } from "../../shared/ui/Button";

interface Props {
  ratio: Ratio;
  onChange: (ratio: Ratio) => boolean | Promise<boolean>;
  resetEpoch: number;
  onValidity: (valid: boolean) => void;
  disabled: boolean;
}
export function RatioControl({ ratio, onChange, onValidity, disabled, resetEpoch }: Props) {
  const presets = useRatioPresets();
  const [width, setWidth] = useState(String(ratio.width));
  const [height, setHeight] = useState(String(ratio.height));
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const previousReset = useRef(resetEpoch);
  useEffect(() => {
    if (previousReset.current === resetEpoch) return;
    previousReset.current = resetEpoch;
    setWidth(String(ratio.width));
    setHeight(String(ratio.height));
    setError(null);
  }, [resetEpoch, ratio.width, ratio.height]);
  const selectedId =
    selected ??
    presets.query.data?.find(
      (preset) =>
        preset.builtin && preset.ratio.width / preset.ratio.height === ratio.width / ratio.height,
    )?.id ??
    "";
  async function apply(w: string, h: string, presetId: string) {
    setWidth(w);
    setHeight(h);
    try {
      const value = validateRatio(w, h);
      setError(null);
      onValidity(true);
      if (!(await onChange(value))) {
        setWidth(String(ratio.width));
        setHeight(String(ratio.height));
        return false;
      }
      setSelected(presetId);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      onValidity(false);
      return false;
    }
  }
  async function selectPreset(id: string) {
    const preset = presets.query.data?.find((item) => item.id === id);
    if (!preset) {
      setSelected("");
      return;
    }
    if (await apply(String(preset.ratio.width), String(preset.ratio.height), id)) {
      if (!preset.builtin) setName(preset.name);
    }
  }
  const custom = presets.query.data?.find((preset) => preset.id === selectedId && !preset.builtin);
  return (
    <fieldset className="crop-control-group crop-ratio" disabled={disabled || presets.busy}>
      <legend>裁剪比例</legend>
      <div className="crop-ratio-shortcuts" aria-label="常用裁剪比例">
        {presets.query.data
          ?.filter((preset) => preset.builtin)
          .map((preset) => (
            <Button
              key={preset.id}
              data-testid={`crop-ratio-quick-${preset.id}`}
              aria-pressed={selectedId === preset.id}
              className={selectedId === preset.id ? "is-active" : ""}
              onClick={() => selectPreset(preset.id)}
            >
              {preset.name}
            </Button>
          ))}
      </div>
      <label className="form-field">
        <span>比例预设</span>
        <select
          data-testid="crop-ratio-preset"
          value={selectedId}
          onChange={(event) => selectPreset(event.target.value)}
        >
          <option value="">自定义比例</option>
          {presets.query.data?.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {preset.name}
              {preset.builtin ? "" : " · 自定义"}
            </option>
          ))}
        </select>
      </label>
      <div className="crop-ratio-fields">
        <label className="form-field">
          <span>宽</span>
          <input
            data-testid="crop-ratio-width"
            type="number"
            step="any"
            value={width}
            onChange={(event) => {
              void apply(event.target.value, height, custom?.id ?? "");
            }}
          />
        </label>
        <span className="crop-ratio-separator" aria-hidden="true">
          :
        </span>
        <label className="form-field">
          <span>高</span>
          <input
            data-testid="crop-ratio-height"
            type="number"
            step="any"
            value={height}
            onChange={(event) => {
              void apply(width, event.target.value, custom?.id ?? "");
            }}
          />
        </label>
        <Button
          type="button"
          icon={<ArrowLeftRight size={15} />}
          data-testid="crop-ratio-swap"
          title="宽高互换"
          aria-label="宽高互换"
          onClick={() => {
            void apply(height, width, custom?.id ?? "");
          }}
        />
      </div>
      <details className="crop-preset-manager">
        <summary data-testid="crop-preset-manager">管理自定义预设</summary>
        <label className="form-field">
          <span>预设名称</span>
          <input
            data-testid="crop-preset-name"
            placeholder="例如：横向人物构图"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <div className="crop-actions">
          <Button
            type="button"
            icon={<Plus size={13} />}
            data-testid="crop-preset-create"
            disabled={!name.trim() || Boolean(error)}
            onClick={() => void presets.save(null, { name, ratio })}
          >
            保存为新预设
          </Button>
          <Button
            type="button"
            icon={<Save size={13} />}
            data-testid="crop-preset-update"
            disabled={!custom || !name.trim() || Boolean(error)}
            onClick={() => void presets.save(selectedId, { name, ratio })}
          >
            更新
          </Button>
          <Button
            type="button"
            tone="danger"
            icon={<Trash2 size={13} />}
            data-testid="crop-preset-delete"
            disabled={!custom}
            onClick={() => void presets.remove(selectedId)}
          >
            删除
          </Button>
        </div>
        <p className="crop-description">应用级保存，单图与批量裁剪共用。</p>
      </details>
      {(error || presets.error || presets.query.error) && (
        <p className="form-error" role="alert" data-testid="crop-ratio-error">
          {error || presets.error || presets.query.error?.message}
        </p>
      )}
    </fieldset>
  );
}
