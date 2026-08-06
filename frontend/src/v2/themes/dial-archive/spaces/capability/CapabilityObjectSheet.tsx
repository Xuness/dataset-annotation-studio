import { useEffect, useState } from "react";

import type {
  CapabilityObjectEditor,
  CapabilityObjectRecord,
} from "../../../../pages/spaces/spacePageModel";
import { CapabilityEditorSurface } from "./CapabilityEditorSurface";

interface CapabilityObjectSheetProps {
  object: CapabilityObjectRecord;
  editor: CapabilityObjectEditor | null;
  dirty: boolean;
  onDirtyChange(dirty: boolean): void;
  onClose(): void;
}

function formatUpdatedAt(value: string | null): string {
  if (!value) return "NO REVISION DATE";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsed);
}

export function CapabilityObjectSheet({
  object,
  editor,
  dirty,
  onDirtyChange,
  onClose,
}: CapabilityObjectSheetProps) {
  const [confirmClose, setConfirmClose] = useState(false);
  const prompt = object.kind === "system-prompt" || object.kind === "translation-prompt";
  const editorWide = Boolean(
    editor && ["provider", "tagger-profile", "dictionary-overrides"].includes(editor.kind),
  );
  useEffect(() => setConfirmClose(false), [dirty, object.id]);

  const requestClose = () => {
    if (dirty && !confirmClose) {
      setConfirmClose(true);
      return;
    }
    onDirtyChange(false);
    onClose();
  };

  return (
    <aside
      className={`dial-archive-capability-sheet${prompt ? " is-document" : ""}${editorWide ? " is-editor" : ""}`}
      aria-label={`${object.name} 能力档案`}
      data-dial-archive-entry
    >
      <div className="dial-archive-capability-sheet__backplate" aria-hidden="true" />
      <div className="dial-archive-capability-sheet__hinge">
        <div className="dial-archive-capability-sheet__hinge-head">
          <span>{object.code}</span>
          <i aria-hidden="true" />
        </div>
        <strong>{object.name}</strong>
        <small>{object.englishName}</small>
        <p>{object.statusLabel}</p>
      </div>
      <div className="dial-archive-capability-sheet__paper">
        <header className="dial-archive-capability-sheet__header">
          <div>
            <span>CAPABILITY OBJECT / {object.kind.replaceAll("-", " ").toUpperCase()}</span>
            <h2>{object.name}</h2>
            <p>{object.summary}</p>
          </div>
          <button
            type="button"
            className={confirmClose ? "is-confirming" : undefined}
            onClick={requestClose}
            aria-label={confirmClose ? "确认放弃未保存修改" : "折回能力档案"}
          >
            <span aria-hidden="true">×</span>
            {confirmClose ? "DISCARD?" : dirty ? "UNSAVED" : "CLOSE"}
          </button>
        </header>

        <div className="dial-archive-capability-sheet__readings">
          {object.readings.map((reading) => (
            <div key={reading.label} data-tone={reading.tone ?? "neutral"}>
              <span>{reading.label}</span>
              <strong>{reading.value}</strong>
            </div>
          ))}
        </div>

        {editor ? (
          <CapabilityEditorSurface
            key={`${object.id}:${editor.kind}`}
            editor={editor}
            onDirtyChange={onDirtyChange}
          />
        ) : null}

        {!editor && object.items.length ? (
          <section className="dial-archive-capability-sheet__section">
            <header>
              <span>ATTACHED INDEX</span>
              <em>{String(object.items.length).padStart(2, "0")}</em>
            </header>
            <div className="dial-archive-capability-sheet__items">
              {object.items.map((item) => (
                <div key={item.id} data-tone={item.tone ?? "neutral"}>
                  <i aria-hidden="true" />
                  <span>{item.label}</span>
                  <strong>{item.value}</strong>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {!editor && object.body ? (
          <section className="dial-archive-capability-sheet__section is-body">
            <header>
              <span>{prompt ? "PROMPT DOCUMENT" : "OBJECT TRACE"}</span>
              <em>READ ONLY</em>
            </header>
            <pre>{object.body}</pre>
          </section>
        ) : null}

        <footer className="dial-archive-capability-sheet__footer">
          <span>REVISION</span>
          <time>{formatUpdatedAt(object.updatedAt)}</time>
          <b>{object.id}</b>
        </footer>
      </div>
    </aside>
  );
}
