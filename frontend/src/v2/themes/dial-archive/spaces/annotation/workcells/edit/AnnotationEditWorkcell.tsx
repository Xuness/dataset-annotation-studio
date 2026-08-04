import { useEffect } from "react";

import type {
  AnnotationCoverageLane,
  AnnotationEditContent,
  AnnotationStageAsset,
} from "../../../../../../pages/spaces/spacePageModel";
import { AnnotationEditHistoryDrawer } from "./AnnotationEditHistoryDrawer";
import { AnnotationEditTagSurface } from "./AnnotationEditTagSurface";
import { AnnotationEditTextSurface } from "./AnnotationEditTextSurface";
import { AnnotationEditTranslationSurface } from "./AnnotationEditTranslationSurface";

interface AnnotationEditWorkcellProps {
  asset: AnnotationStageAsset | null;
  channels: readonly AnnotationCoverageLane[];
  checkedCount: number;
  edit: AnnotationEditContent | null;
}

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
}: AnnotationEditWorkcellProps) {
  useEffect(() => {
    function handleSave(event: KeyboardEvent) {
      if (!edit || !(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "s") return;
      event.preventDefault();
      if (edit.canSave) void edit.save();
    }
    window.addEventListener("keydown", handleSave);
    return () => window.removeEventListener("keydown", handleSave);
  }, [edit]);

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
          <span>WC.01 // OBJECT ANNOTATION INSTRUMENT</span>
          <h2 id="edit-workcell-title">标注编辑</h2>
          <output className={`is-${edit.document.availability}`}>
            {activeChannel?.code ?? "—"} / {edit.document.availability.toUpperCase()}
          </output>
        </header>

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

        <div className="dial-archive-edit-workcell__workspace">
          <i className="dial-archive-edit-workcell__register" aria-hidden="true" />
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
              <span>{edit.dirty ? "LOCAL DRAFT // UNSAVED" : "REVISION HEAD // SYNCHRONIZED"}</span>
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
          </footer>

          <aside className={`dial-archive-edit-workcell__commit${edit.dirty ? " is-dirty" : ""}`}>
            <span>WRITE CONTROL</span>
            <button type="button" onClick={edit.history.toggle}>
              <small>REV</small>
              <b>历史</b>
            </button>
            <button type="button" disabled={!edit.canDiscard} onClick={() => void edit.discard()}>
              <small>CLR</small>
              <b>撤销</b>
            </button>
            {dictionaryRefresh ? (
              <button
                className="is-primary"
                type="button"
                disabled={edit.writePending}
                onClick={() => void edit.translation.refreshDictionary()}
              >
                <small>SYNC</small>
                <b>刷新词典译文</b>
              </button>
            ) : translationNeedsEdit ? (
              <button
                className="is-primary"
                type="button"
                disabled={!edit.translation.canEdit}
                onClick={edit.translation.beginEditing}
              >
                <small>EDIT</small>
                <b>编辑译文</b>
              </button>
            ) : (
              <button
                className="is-primary"
                type="button"
                disabled={!edit.canSave}
                onClick={() => void edit.save()}
              >
                <small>CTRL+S</small>
                <b>{edit.writePending ? "正在写入" : edit.saveLabel}</b>
              </button>
            )}
          </aside>

          <AnnotationEditHistoryDrawer history={edit.history} />
        </div>
      </section>
    </div>
  );
}
