import type { CharacterAuditContent } from "../../../src/application/characterAudits/characterAuditModel";
import { CharacterConfiguration } from "./CharacterConfiguration";
import { CharacterExecution } from "./CharacterExecution";

export function CharacterSettings({
  content: c,
  profileIndex,
  onProfileChange,
}: {
  content: CharacterAuditContent;
  profileIndex: number;
  onProfileChange: (index: number) => void;
}) {
  const op = c.operation;
  return (
    <aside
      className="character-settings-pane"
      data-testid="character-settings-pane"
      data-surface-region="secondary-sidebar"
    >
      <header>
        <span className="eyebrow">Parameters</span>
        <h2>角色审查参数</h2>
      </header>
      {!op ? (
        <>
          <label className="form-field">
            <span>参考图操作目标</span>
            <select
              data-testid="character-config-profile"
              value={profileIndex}
              disabled={c.busy}
              onChange={(event) => onProfileChange(Number(event.target.value))}
            >
              {c.form.profiles.map((profile, index) => (
                <option key={index} value={index}>
                  角色 {index + 1} · {profile.trigger || "待命名"}
                </option>
              ))}
            </select>
          </label>
          <CharacterConfiguration content={c} />
        </>
      ) : (
        <>
          <CharacterExecution content={c} />
          <details className="character-snapshot">
            <summary data-testid="character-settings-snapshot">查看已锁定的任务参数</summary>
            <dl>
              <dt>处理范围</dt>
              <dd>
                {
                  { all: "整个项目", directory: "指定目录", selected: "创建时勾选素材" }[
                    op.request.scope
                  ]
                }{" "}
                · {op.source_assets.length} 张
              </dd>
              <dt>目录</dt>
              <dd>{op.request.directory ?? "—"}</dd>
              <dt>审查风格</dt>
              <dd>{op.request.style === "sparse" ? "精简核心特征" : "完整角色特征"}</dd>
              <dt>最低图片出现次数</dt>
              <dd>{op.request.minimum_count}</dd>
              <dt>模型连接</dt>
              <dd>{op.provider.name}</dd>
              <dt>视觉模型</dt>
              <dd>{op.provider.model.model_id}</dd>
              <dt>额外重试次数</dt>
              <dd>{op.request.retry_limit}</dd>
              <dt>语义词表</dt>
              <dd>{op.request.vocabulary_id}</dd>
            </dl>
            {op.request.profiles.map((profile, index) => (
              <section key={profile.trigger}>
                <h3>{profile.trigger}</h3>
                <p>参考图：{op.references[index]?.relative_path}</p>
                <p>
                  归属：
                  {profile.membership === "trigger"
                    ? "Tags 包含触发词"
                    : `目录 ${profile.directory || "/"}`}
                </p>
                <p>人数标签：{profile.subject}</p>
              </section>
            ))}
            <p>任务输入已保存为快照，浏览和勾选图片不会修改本次任务。</p>
          </details>
        </>
      )}
    </aside>
  );
}
