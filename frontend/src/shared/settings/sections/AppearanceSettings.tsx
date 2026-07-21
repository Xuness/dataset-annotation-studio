import { useState, type CSSProperties } from "react";
import { Check, ImagePlus, RotateCcw, Trash2, X } from "lucide-react";

import {
  chooseCustomBackground,
  clearCustomBackground,
  supportsCustomBackgrounds,
} from "../../desktop/customBackground";
import { useAppPreferences } from "../../theme/appPreferences";
import {
  resolveAppearance,
  SCENE_LIMITS,
  WORKSPACE_SURFACE_REGIONS,
  type SceneOverrides,
  type SceneTarget,
  type WorkspaceSurfaceRegion,
} from "../../theme/appearance";
import { DEFAULT_THEME_ID, THEMES } from "../../theme/themes";
import { Button } from "../../ui/Button";
import { Spinner } from "../../ui/Spinner";

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

const surfaceRegionOptions: ReadonlyArray<{
  id: WorkspaceSurfaceRegion;
  title: string;
  scope: string;
  description: string;
}> = [
  {
    id: "canvas",
    title: "图片画布",
    scope: "素材 · 审核",
    description: "移除网格与画布底色，让场景直接衬在图片背后。",
  },
  {
    id: "navigation",
    title: "功能导航",
    scope: "全部工作页",
    description: "让最左侧的页面入口栏透出工作区背景。",
  },
  {
    id: "primary-sidebar",
    title: "左侧功能栏",
    scope: "列表 · 参数",
    description: "覆盖素材列表、任务创建以及预处理和导出参数栏。",
  },
  {
    id: "content",
    title: "中央内容区",
    scope: "编辑 · 预览",
    description: "覆盖标注编辑器、任务列表和各种执行预览。",
  },
  {
    id: "secondary-sidebar",
    title: "右侧详情栏",
    scope: "检查器 · 历史",
    description: "覆盖素材检查器、任务详情和操作历史。",
  },
  {
    id: "chrome",
    title: "工作区框架",
    scope: "顶栏 · 状态栏",
    description: "让工作区顶栏和底部状态栏也融入场景。",
  },
];

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

export function AppearanceSettings({ onClose }: { onClose: () => void }) {
  const preferences = useAppPreferences((state) => state.preferences);
  const setTheme = useAppPreferences((state) => state.setTheme);
  const setCustomBackground = useAppPreferences((state) => state.setCustomBackground);
  const setSceneOverrides = useAppPreferences((state) => state.setSceneOverrides);
  const resetSceneOverrides = useAppPreferences((state) => state.resetSceneOverrides);
  const setRegionTransparency = useAppPreferences((state) => state.setRegionTransparency);
  const setAllRegionsTransparent = useAppPreferences((state) => state.setAllRegionsTransparent);
  const resetRegionTransparency = useAppPreferences((state) => state.resetRegionTransparency);
  const setImmersiveMode = useAppPreferences((state) => state.setImmersiveMode);
  const [backgroundPending, setBackgroundPending] = useState(false);
  const [backgroundError, setBackgroundError] = useState<string | null>(null);
  const resolved = resolveAppearance(preferences);
  const customBackground = preferences.appearance.customBackground;
  const backgroundSupported = supportsCustomBackgrounds();
  const transparentRegions = preferences.appearance.transparentRegions;
  const immersiveMode = preferences.appearance.immersiveMode;
  const allRegionsTransparent = WORKSPACE_SURFACE_REGIONS.every(
    (region) => transparentRegions[region],
  );

  async function selectBackground() {
    setBackgroundError(null);
    setBackgroundPending(true);
    try {
      const selected = await chooseCustomBackground();
      if (selected) setCustomBackground(selected);
    } catch (error) {
      setBackgroundError(error instanceof Error ? error.message : "无法保存自定义背景图片。");
    } finally {
      setBackgroundPending(false);
    }
  }

  async function removeBackground() {
    setBackgroundError(null);
    setCustomBackground(null);
    setBackgroundPending(true);
    try {
      await clearCustomBackground();
    } catch (error) {
      setBackgroundError(
        error instanceof Error
          ? `已恢复主题背景，但旧图片暂未清理：${error.message}`
          : "已恢复主题背景，但旧图片暂未清理。",
      );
    } finally {
      setBackgroundPending(false);
    }
  }

  return (
    <>
      <header>
        <div>
          <span className="eyebrow">Appearance</span>
          <h2>外观与主题</h2>
          <p>主题负责色彩与基调；背景图片、显影参数和区域透光作为独立覆盖层保存。</p>
        </div>
        <button
          type="button"
          className="settings-center__close"
          data-settings-close=""
          onClick={onClose}
          aria-label="关闭设置"
          title="关闭设置"
        >
          <X size={18} />
        </button>
      </header>

      <div className="appearance-settings">
        <section className="appearance-section appearance-background">
          <div className="appearance-section__heading">
            <div>
              <span className="eyebrow">Personal scene</span>
              <h3>自定义背景</h3>
            </div>
            <small>PNG · JPEG · WebP，最大 64 MB</small>
          </div>
          <div className="appearance-background__body">
            <div className="appearance-background__preview" aria-hidden="true">
              <span />
              <i>{customBackground ? "CUSTOM SCENE" : resolved.theme.englishName}</i>
            </div>
            <div className="appearance-background__copy">
              <strong>{customBackground?.name ?? "使用主题自带场景"}</strong>
              <p>
                {customBackground
                  ? "图片已复制到 Dataset Studio 的本地数据目录；移动或删除原图不会影响显示。"
                  : "选择一张图片后，它会同时用于首页与主工作区；切换主题仍会保留这张图片。"}
              </p>
              <div>
                <Button
                  icon={backgroundPending ? <Spinner /> : <ImagePlus size={14} />}
                  onClick={() => void selectBackground()}
                  disabled={backgroundPending || !backgroundSupported}
                >
                  {customBackground ? "更换图片" : "选择图片"}
                </Button>
                {customBackground ? (
                  <Button
                    icon={<Trash2 size={14} />}
                    onClick={() => void removeBackground()}
                    disabled={backgroundPending}
                  >
                    恢复主题背景
                  </Button>
                ) : null}
              </div>
              {!backgroundSupported ? (
                <small className="appearance-background__hint">请在桌面版中选择本地图片。</small>
              ) : null}
              {backgroundError ? <small className="form-error">{backgroundError}</small> : null}
            </div>
          </div>
        </section>

        <section className="appearance-section">
          <div className="appearance-section__heading">
            <div>
              <span className="eyebrow">Immersive workspace</span>
              <h3>沉浸模式</h3>
            </div>
            <small>关闭后恢复原有区域选择</small>
          </div>
          <button
            type="button"
            className={`immersive-mode-card ${immersiveMode ? "is-active" : ""}`}
            aria-pressed={immersiveMode}
            onClick={() => setImmersiveMode(!immersiveMode)}
          >
            <span className="immersive-mode-card__mark" aria-hidden="true" />
            <span className="immersive-mode-card__copy">
              <strong>让工作台完全沉入场景</strong>
              <small>
                强制开启全部区域透光，并隐藏面板边界、栏位分隔和常驻拖拽线；输入控件与状态提示仍保留必要轮廓。
              </small>
            </span>
            <span className="immersive-mode-card__state">
              <i aria-hidden="true" />
              {immersiveMode ? "已开启" : "未开启"}
            </span>
          </button>
        </section>

        <section className="appearance-section">
          <div className="appearance-section__heading">
            <div>
              <span className="eyebrow">Scene clarity</span>
              <h3>场景显影</h3>
            </div>
            <small>调整会即时预览并自动保存</small>
          </div>
          <div className="scene-control-grid">
            <SceneControl
              target="home"
              title="首页"
              englishTitle="Landing hall"
              description="控制迎宾场景的显影强度；较低数值会让文案和项目入口更安静。"
              values={resolved.home}
              overrides={preferences.appearance.home}
              onChange={(update) => setSceneOverrides("home", update)}
              onReset={() => resetSceneOverrides("home")}
            />
            <SceneControl
              target="workspace"
              title="主工作区"
              englishTitle="Working archive"
              description="控制工作台底层场景，并同步降低面板遮蔽；高数值会更明显地显露背景。"
              values={resolved.workspace}
              overrides={preferences.appearance.workspace}
              onChange={(update) => setSceneOverrides("workspace", update)}
              onReset={() => resetSceneOverrides("workspace")}
            />
          </div>
        </section>

        <section className="appearance-section">
          <div className="appearance-section__heading">
            <div>
              <span className="eyebrow">Surface permeability</span>
              <h3>区域透光</h3>
            </div>
            <small>大面积材质可独立开关</small>
          </div>
          <div className="surface-transparency">
            <div className="surface-transparency__summary">
              <div>
                <strong>让背景穿过工作台</strong>
                <p>
                  只改变页面的大面积底板；输入框、告警和选中态仍保留必要遮罩，避免全透明时失去可读性。
                </p>
              </div>
              <button
                type="button"
                className={immersiveMode || allRegionsTransparent ? "is-active" : ""}
                aria-pressed={immersiveMode || allRegionsTransparent}
                disabled={immersiveMode}
                onClick={allRegionsTransparent ? resetRegionTransparency : setAllRegionsTransparent}
              >
                {immersiveMode ? "由沉浸模式控制" : allRegionsTransparent ? "恢复建议" : "全部透明"}
              </button>
            </div>
            <div className={`surface-transparency__grid ${immersiveMode ? "is-managed" : ""}`}>
              {surfaceRegionOptions.map((option) => {
                const transparent = immersiveMode || transparentRegions[option.id];
                return (
                  <button
                    type="button"
                    key={option.id}
                    className={`surface-transparency__option ${transparent ? "is-active" : ""}`}
                    aria-pressed={transparent}
                    disabled={immersiveMode}
                    onClick={() => setRegionTransparency(option.id, !transparent)}
                  >
                    <span className="surface-transparency__check" aria-hidden="true">
                      {transparent ? <Check size={12} /> : null}
                    </span>
                    <span className="surface-transparency__copy">
                      <strong>{option.title}</strong>
                      <small>{option.description}</small>
                    </span>
                    <em>{option.scope}</em>
                  </button>
                );
              })}
            </div>
          </div>
        </section>

        <section className="appearance-section">
          <div className="appearance-section__heading">
            <div>
              <span className="eyebrow">Theme registry</span>
              <h3>主题预设</h3>
            </div>
            <small>主题切换不覆盖自定义背景参数</small>
          </div>
          <div className="theme-preset-grid">
            {THEMES.map((theme) => {
              const selected = theme.id === preferences.themeId;
              const previewStyle = {
                "--theme-preview-image": `url(${JSON.stringify(theme.scene.image)})`,
                "--theme-preview-position": theme.scene.previewPosition,
                "--theme-preview-backdrop": theme.swatches[0],
                "--theme-preview-surface": theme.swatches[1],
                "--theme-preview-ink": theme.swatches[2],
                "--theme-preview-accent": theme.swatches[3],
              } as CSSProperties;
              return (
                <button
                  type="button"
                  key={theme.id}
                  className={`theme-preset-card ${selected ? "is-selected" : ""}`}
                  aria-pressed={selected}
                  onClick={() => setTheme(theme.id)}
                >
                  <span className="theme-preset-card__preview" style={previewStyle}>
                    <span className="theme-preset-card__frame" aria-hidden="true">
                      <span />
                      <span />
                      <span />
                    </span>
                    {selected ? (
                      <span className="theme-preset-card__selected">
                        <Check size={13} /> 当前主题
                      </span>
                    ) : null}
                  </span>
                  <span className="theme-preset-card__copy">
                    <span>
                      <strong>{theme.name}</strong>
                      {theme.id === DEFAULT_THEME_ID ? <em>默认</em> : null}
                      <small>{theme.englishName}</small>
                    </span>
                    <span className="theme-preset-card__swatches" aria-hidden="true">
                      {theme.swatches.map((color) => (
                        <i key={color} style={{ backgroundColor: color }} />
                      ))}
                    </span>
                    <span>{theme.description}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      </div>

      <footer>
        <span>外观设置仅保存在当前设备</span>
        <span>{customBackground ? "正在使用自定义场景" : `当前主题 · ${resolved.theme.name}`}</span>
      </footer>
    </>
  );
}
