import { useEffect, useState, type FormEvent } from "react";
import { RotateCcw, Save } from "lucide-react";

import { useAppPreferences } from "../../../theme/appPreferences";
import {
  DEFAULT_HOME_CONTENT,
  HOME_CONTENT_LIMITS,
  type HomeContentPreferences,
} from "../../../theme/appearance";
import { Button } from "../../../ui/Button";

function cleanInlineText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function HomeContentSection() {
  const content = useAppPreferences((state) => state.preferences.homeContent);
  const setHomeContent = useAppPreferences((state) => state.setHomeContent);
  const resetHomeContent = useAppPreferences((state) => state.resetHomeContent);
  const [draft, setDraft] = useState<HomeContentPreferences>(content);

  useEffect(() => {
    setDraft(content);
  }, [content]);

  const cleanedDraft = {
    headline: cleanInlineText(draft.headline),
    description: cleanInlineText(draft.description),
  };
  const validationMessage = !cleanedDraft.headline
    ? "首页主标题不能为空。"
    : !cleanedDraft.description
      ? "首页说明文字不能为空。"
      : null;
  const hasChanges =
    cleanedDraft.headline !== content.headline || cleanedDraft.description !== content.description;
  const usesDefaults =
    content.headline === DEFAULT_HOME_CONTENT.headline &&
    content.description === DEFAULT_HOME_CONTENT.description &&
    draft.headline === DEFAULT_HOME_CONTENT.headline &&
    draft.description === DEFAULT_HOME_CONTENT.description;

  function updateDraft(field: keyof HomeContentPreferences, value: string) {
    setDraft((current) => ({ ...current, [field]: value }));
  }

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (validationMessage || !hasChanges) return;
    setHomeContent(cleanedDraft);
  }

  function restoreDefaults() {
    resetHomeContent();
    setDraft({ ...DEFAULT_HOME_CONTENT });
  }

  return (
    <section className="appearance-section home-content-section">
      <div className="appearance-section__heading">
        <div>
          <span className="eyebrow">Home introduction</span>
          <h3>首页文案</h3>
        </div>
        <small>跨主题使用，仅保存在当前设备</small>
      </div>

      <form className="home-content-editor" onSubmit={save}>
        <div className="home-content-editor__preview" aria-label="首页文案预览">
          <span>Landing copy</span>
          <strong>{cleanedDraft.headline || "等待一句开场白……"}</strong>
          <p>{cleanedDraft.description || "等待一行说明文字……"}</p>
        </div>

        <div className="home-content-editor__fields">
          <label className="form-field" htmlFor="home-content-headline">
            <span>
              首页主标题
              <small>
                {draft.headline.length}/{HOME_CONTENT_LIMITS.headline}
              </small>
            </span>
            <input
              id="home-content-headline"
              type="text"
              value={draft.headline}
              maxLength={HOME_CONTENT_LIMITS.headline}
              aria-invalid={!cleanedDraft.headline}
              onChange={(event) => updateDraft("headline", event.currentTarget.value)}
            />
          </label>

          <label className="form-field" htmlFor="home-content-description">
            <span>
              首页说明文字
              <small>
                {draft.description.length}/{HOME_CONTENT_LIMITS.description}
              </small>
            </span>
            <input
              id="home-content-description"
              type="text"
              value={draft.description}
              maxLength={HOME_CONTENT_LIMITS.description}
              aria-invalid={!cleanedDraft.description}
              onChange={(event) => updateDraft("description", event.currentTarget.value)}
            />
          </label>

          <div className="home-content-editor__actions">
            <span className={validationMessage ? "form-error" : ""} aria-live="polite">
              {validationMessage ?? "保存后，首页会立即使用新的文案。"}
            </span>
            <div>
              <Button
                type="button"
                icon={<RotateCcw size={14} />}
                onClick={restoreDefaults}
                disabled={usesDefaults}
              >
                恢复默认
              </Button>
              <Button
                type="submit"
                tone="primary"
                icon={<Save size={14} />}
                disabled={Boolean(validationMessage) || !hasChanges}
              >
                保存文案
              </Button>
            </div>
          </div>
        </div>
      </form>
    </section>
  );
}
