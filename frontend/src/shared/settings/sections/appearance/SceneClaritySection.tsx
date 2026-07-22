import type { CSSProperties } from "react";
import { RotateCcw } from "lucide-react";

import { useAppPreferences } from "../../../theme/appPreferences";
import {
  getThemeSceneOverrides,
  resolveAppearance,
  SCENE_LIMITS,
  type SceneOverrides,
  type SceneTarget,
} from "../../../theme/appearance";

interface SceneControlProps {
  target: SceneTarget;
  title: string;
  englishTitle: string;
  description: string;
  values: { opacity: number; blurPx: number };
  overrides: SceneOverrides;
  onChange: (update: Partial<SceneOverrides>) => void;
  onReset: () => void;
}

function SceneControl({
  target,
  title,
  englishTitle,
  description,
  values,
  overrides,
  onChange,
  onReset,
}: SceneControlProps) {
  const customized = overrides.opacity !== null || overrides.blurPx !== null;
  const opacityPercent = Math.round(values.opacity * 100);

  return (
    <article className={`scene-control scene-control--${target}`}>
      <div className="scene-control__preview" aria-hidden="true">
        <span />
        <i>{target === "home" ? "HOME" : "WORKSPACE"}</i>
      </div>
      <div className="scene-control__heading">
        <div>
          <strong>{title}</strong>
          <small>{englishTitle}</small>
        </div>
        <button type="button" onClick={onReset} disabled={!customized} title="恢复当前主题建议值">
          <RotateCcw size={13} aria-hidden="true" />
          重置
        </button>
      </div>
      <p>{description}</p>
      <label>
        <span>
          背景可见度 <output>{opacityPercent}%</output>
        </span>
        <input
          type="range"
          min={SCENE_LIMITS.opacity.min * 100}
          max={SCENE_LIMITS.opacity.max * 100}
          step="1"
          value={opacityPercent}
          style={{ "--range-progress": `${opacityPercent}%` } as CSSProperties}
          aria-label={`${title}背景可见度`}
          onChange={(event) => onChange({ opacity: Number(event.target.value) / 100 })}
        />
      </label>
      <label>
        <span>
          背景虚化 <output>{Math.round(values.blurPx)} px</output>
        </span>
        <input
          type="range"
          min={SCENE_LIMITS.blurPx.min}
          max={SCENE_LIMITS.blurPx.max}
          step="1"
          value={Math.round(values.blurPx)}
          style={
            {
              "--range-progress": `${(values.blurPx / SCENE_LIMITS.blurPx.max) * 100}%`,
            } as CSSProperties
          }
          aria-label={`${title}背景虚化`}
          onChange={(event) => onChange({ blurPx: Number(event.target.value) })}
        />
      </label>
    </article>
  );
}

export function SceneClaritySection() {
  const preferences = useAppPreferences((state) => state.preferences);
  const setThemeSceneOverrides = useAppPreferences((state) => state.setThemeSceneOverrides);
  const resetThemeSceneOverrides = useAppPreferences((state) => state.resetThemeSceneOverrides);
  const resolved = resolveAppearance(preferences);
  const overrides = getThemeSceneOverrides(preferences.appearance, resolved.theme.id);

  return (
    <section className="appearance-section">
      <div className="appearance-section__heading">
        <div>
          <span className="eyebrow">Scene clarity</span>
          <h3>场景显影</h3>
        </div>
        <small>仅作用于“{resolved.theme.name}”，调整会即时预览并自动保存</small>
      </div>
      <div className="scene-control-grid">
        <SceneControl
          target="home"
          title="首页"
          englishTitle="Landing hall"
          description="控制迎宾场景的显影强度；较低数值会让文案和项目入口更安静。"
          values={resolved.home}
          overrides={overrides.home}
          onChange={(update) => setThemeSceneOverrides(resolved.theme.id, "home", update)}
          onReset={() => resetThemeSceneOverrides(resolved.theme.id, "home")}
        />
        <SceneControl
          target="workspace"
          title="主工作区"
          englishTitle="Working archive"
          description="控制工作台底层场景，并同步降低面板遮蔽；高数值会更明显地显露背景。"
          values={resolved.workspace}
          overrides={overrides.workspace}
          onChange={(update) => setThemeSceneOverrides(resolved.theme.id, "workspace", update)}
          onReset={() => resetThemeSceneOverrides(resolved.theme.id, "workspace")}
        />
      </div>
    </section>
  );
}
