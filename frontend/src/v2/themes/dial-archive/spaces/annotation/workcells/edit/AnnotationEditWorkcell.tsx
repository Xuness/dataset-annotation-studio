import { useEffect } from "react";

import type {
  AnnotationBatchContent,
  AnnotationCoverageLane,
  AnnotationEditContent,
  AnnotationEditSectionId,
  AnnotationProjectContextContent,
  AnnotationRequestPreviewContent,
  AnnotationStageAsset,
} from "../../../../../../pages/spaces/spacePageModel";
import { AnnotationBatchSurface } from "./AnnotationBatchSurface";
import { AnnotationEditHistoryDrawer } from "./AnnotationEditHistoryDrawer";
import { AnnotationEditTagSurface } from "./AnnotationEditTagSurface";
import { AnnotationEditTextSurface } from "./AnnotationEditTextSurface";
import { AnnotationEditTranslationSurface } from "./AnnotationEditTranslationSurface";
import { AnnotationProjectContextSurface } from "./AnnotationProjectContextSurface";
import { AnnotationRequestPreviewSurface } from "./AnnotationRequestPreviewSurface";

interface AnnotationEditWorkcellProps {
  asset: AnnotationStageAsset | null;
  channels: readonly AnnotationCoverageLane[];
  checkedCount: number;
  edit: AnnotationEditContent | null;
  section: AnnotationEditSectionId;
  projectContext: AnnotationProjectContextContent | null;
  requestPreview: AnnotationRequestPreviewContent | null;
  batch: AnnotationBatchContent | null;
  onSelectSection(section: AnnotationEditSectionId): void;
}

const EDIT_SECTIONS: ReadonlyArray<{
  id: AnnotationEditSectionId;
  code: string;
  title: string;
  english: string;
}> = [
  { id: "annotation", code: "01", title: "标注编辑", english: "DOCUMENT" },
  { id: "context", code: "02", title: "项目上下文", english: "CONTEXT" },
  { id: "preview", code: "03", title: "请求预览", english: "REQUEST" },
  { id: "batch", code: "04", title: "范围与批量", english: "RANGE" },
];

function formatTimestamp(value: string | null, fallback: string): string {
  if (!value) return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date.toLocaleString();
}

export function AnnotationEditWorkcell({
  asset,
  channels,
  checkedCount,
  edit,
  section,
  projectContext,
  requestPreview,
  batch,
  onSelectSection,
}: AnnotationEditWorkcellProps) {
  useEffect(() => {
    function handleSave(event: KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "s") return;
      event.preventDefault();
      if (section === "context" && projectContext?.canSave) void projectContext.save();
      else if (section === "annotation" && edit?.canSave) void edit.save();
    }
    window.addEventListener("keydown", handleSave);
    return () => window.removeEventListener("keydown", handleSave);
  }, [edit, projectContext, section]);

  if (!edit) {
    return (
      <div className="dial-archive-edit-workcell is-empty" role="status">
        <span>EDIT CONTRACT // NO PROJECT CONTEXT</span>
        <b>当前没有可装载的标注控制器</b>
      </div>
    );
  }

  const activeChannel = edit.channels.find((channel) => channel.id === edit.channel);
  const coverage = channels.find((channel) => channel.id === edit.channel);
  const modifiedAt = formatTimestamp(edit.document.modifiedAt, "时间未记录");
  const translationNeedsEdit =
    edit.channel === "translation" &&
    !edit.translation.readOnly &&
    !edit.translation.editing &&
    !edit.tagsDirty;
  const dictionaryRefresh =
    edit.channel === "translation" &&
    edit.translation.readOnly &&
    edit.translation.canRefreshDictionary;
  const activeSection = EDIT_SECTIONS.find((item) => item.id === section) ?? EDIT_SECTIONS[0];

  return (
    <div className="dial-archive-edit-workcell">
      <div className="dial-archive-edit-workcell__ghost" aria-hidden="true">
        EDIT
      </div>

      <aside className="dial-archive-edit-workcell__object" aria-label="当前编辑对象">
        <span>OBJECT LOCK // CURRENT</span>
        <b>{asset?.filename ?? "NO MATERIAL"}</b>
        <small>{asset?.relativePath ?? "当前序列没有可编辑素材"}</small>
        <dl>
          <div>
            <dt>SIZE</dt>
            <dd>{asset ? `${asset.width} × ${asset.height}` : "—"}</dd>
          </div>
          <div>
            <dt>FORMAT</dt>
            <dd>{asset?.suffix.replace(/^\./u, "").toUpperCase() || "—"}</dd>
          </div>
          <div>
            <dt>RANGE</dt>
            <dd>{checkedCount > 0 ? `${checkedCount} MATERIAL` : "CURRENT ONLY"}</dd>
          </div>
        </dl>
      </aside>

      <section
        className="dial-archive-edit-workcell__console"
        aria-labelledby="edit-workcell-title"
      >
        <header className="dial-archive-edit-workcell__heading">
          <span>
            WC.01 / {activeSection.code} // {activeSection.english} INSTRUMENT
          </span>
          <h2 id="edit-workcell-title">{activeSection.title}</h2>
          <output className={section === "annotation" ? `is-${edit.document.availability}` : ""}>
            {section === "annotation"
              ? `${activeChannel?.code ?? "—"} / ${edit.document.availability.toUpperCase()}`
              : `${activeSection.code} / ${activeSection.english}`}
          </output>
        </header>

        {section === "annotation" ? (
          <nav className="dial-archive-edit-workcell__channels" aria-label="标注编辑通道">
            {edit.channels.map((channel) => {
              const active = channel.id === edit.channel;
              return (
                <button
                  className={`${active ? "is-active" : ""} is-${channel.state}`}
                  type="button"
                  aria-pressed={active}
                  disabled={!channel.enabled || edit.writePending}
                  title={channel.enabled ? channel.stateLabel : "当前素材没有可读取的旧 TXT 标注"}
                  onClick={() => void edit.selectChannel(channel.id)}
                  key={channel.id}
                >
                  <span>{channel.code}</span>
                  <b>{channel.title}</b>
                  <em>{channel.stateLabel}</em>
                </button>
              );
            })}
          </nav>
        ) : (
          <div className="dial-archive-edit-workcell__section-band">
            <span>
              {activeSection.code} / {activeSection.english}
            </span>
            <b>
              {section === "context"
                ? "定义项目级模型指令与素材上下文"
                : section === "preview"
                  ? "核对下一次真实多模态请求"
                  : "以当前素材范围执行可预览的批量操作"}
            </b>
            <i aria-hidden="true" />
          </div>
        )}

        <div className={`dial-archive-edit-workcell__workspace is-section-${section}`}>
          <i className="dial-archive-edit-workcell__register" aria-hidden="true" />
          {section === "annotation" ? (
            <>
              <header className="dial-archive-edit-workcell__document-head">
                <div>
                  <span>{activeChannel?.code ?? "—"} // ACTIVE DOCUMENT</span>
                  <h3>{edit.document.displayName}</h3>
                  <p>
                    {edit.document.sourceLabel ?? "尚无版本来源"} · {modifiedAt}
                  </p>
                </div>
                <dl>
                  <div>
                    <dt>OBJECT STATE</dt>
                    <dd>{edit.document.availabilityLabel}</dd>
                  </div>
                  <div>
                    <dt>PROJECT COVERAGE</dt>
                    <dd>{coverage ? `${coverage.coveragePercent}%` : "OBJECT ONLY"}</dd>
                  </div>
                  <div>
                    <dt>REVISION</dt>
                    <dd>{edit.document.reviewStatus === "reviewed" ? "REVIEWED" : "OPEN"}</dd>
                  </div>
                </dl>
              </header>

              <div className="dial-archive-edit-workcell__surface">
                {edit.status === "no-object" ? (
                  <div className="dial-archive-edit-workcell__state">
                    <span>OBJECT CHANNEL // NO MATERIAL</span>
                    <b>选择素材后开始施工</b>
                  </div>
                ) : edit.status === "loading" ? (
                  <div className="dial-archive-edit-workcell__state is-loading" role="status">
                    <span>READING ANNOTATION REGISTER</span>
                    <b>正在装载当前标注通道</b>
                    <i aria-hidden="true" />
                  </div>
                ) : edit.status === "error" ? (
                  <div className="dial-archive-edit-workcell__state is-error" role="alert">
                    <span>CHANNEL READ FAILURE</span>
                    <b>{edit.message ?? "无法读取当前通道。"}</b>
                  </div>
                ) : edit.channel === "tags" ? (
                  <AnnotationEditTagSurface model={edit.tags} />
                ) : edit.channel === "translation" ? (
                  <AnnotationEditTranslationSurface edit={edit} />
                ) : (
                  <AnnotationEditTextSurface
                    edit={edit}
                    code={activeChannel?.code ?? "TXT"}
                    title={edit.channel === "description" ? "描述施工面" : "原有标注"}
                  />
                )}
              </div>

              <footer className="dial-archive-edit-workcell__footer">
                <div>
                  <span>CURRENT OBJECT // {asset?.id ?? "—"}</span>
                  <span>
                    {edit.dirty ? "LOCAL DRAFT // UNSAVED" : "REVISION HEAD // SYNCHRONIZED"}
                  </span>
                  {edit.document.validationIssue ? (
                    <strong>{edit.document.validationIssue}</strong>
                  ) : null}
                  {edit.actionError ? <strong>{edit.actionError}</strong> : null}
                </div>
                <label>
                  <span>TOKEN PROFILE</span>
                  <select
                    value={edit.tokenProfileId}
                    onChange={(event) => edit.selectTokenProfile(event.target.value)}
                  >
                    {edit.tokenProfiles.map((profile) => (
                      <option value={profile.id} key={profile.id}>
                        {profile.label}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="dial-archive-edit-workcell__footer-actions">
                  <button type="button" onClick={edit.history.toggle}>
                    历史
                  </button>
                  <button
                    type="button"
                    disabled={!edit.canDiscard}
                    onClick={() => void edit.discard()}
                  >
                    撤销
                  </button>
                  <button
                    className="is-danger"
                    type="button"
                    disabled={!edit.canDelete || edit.deletePending}
                    onClick={() => void edit.deleteCurrent()}
                  >
                    {edit.deletePending ? "删除中" : "删除通道"}
                  </button>
                  {dictionaryRefresh ? (
                    <button
                      className="is-primary"
                      type="button"
                      disabled={edit.writePending}
                      onClick={() => void edit.translation.refreshDictionary()}
                    >
                      刷新词典译文
                    </button>
                  ) : translationNeedsEdit ? (
                    <button
                      className="is-primary"
                      type="button"
                      disabled={!edit.translation.canEdit}
                      onClick={edit.translation.beginEditing}
                    >
                      编辑译文
                    </button>
                  ) : (
                    <button
                      className="is-primary"
                      type="button"
                      disabled={!edit.canSave}
                      onClick={() => void edit.save()}
                    >
                      {edit.writePending ? "正在写入" : edit.saveLabel}
                    </button>
                  )}
                </div>
              </footer>
              <AnnotationEditHistoryDrawer history={edit.history} />
            </>
          ) : section === "context" && projectContext ? (
            <AnnotationProjectContextSurface context={projectContext} />
          ) : section === "preview" && requestPreview ? (
            <AnnotationRequestPreviewSurface preview={requestPreview} asset={asset} />
          ) : section === "batch" && batch ? (
            <AnnotationBatchSurface batch={batch} />
          ) : (
            <div className="dial-archive-edit-workcell__state">
              <span>SECTION CONTRACT</span>
              <b>当前工作面尚未装载</b>
            </div>
          )}

          <nav className="dial-archive-edit-workcell__sections" aria-label="标注工作间页面">
            {EDIT_SECTIONS.map((item) => (
              <button
                className={item.id === section ? "is-active" : undefined}
                type="button"
                aria-pressed={item.id === section}
                aria-label={`${item.code} ${item.title}`}
                title={item.title}
                onClick={() => onSelectSection(item.id)}
                key={item.id}
              >
                <b>{item.code}</b>
                <span>{item.english}</span>
              </button>
            ))}
          </nav>
        </div>
      </section>
    </div>
  );
}
