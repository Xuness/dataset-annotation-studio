import { useEffect, useRef } from "react";

import { Button } from "./Button";
import { useDialogStore } from "./dialogs";

export function DialogHost() {
  const current = useDialogStore((state) => state.queue[0] ?? null);
  const settle = useDialogStore((state) => state.settle);
  const restoreFocusRef = useRef<Element | null>(null);

  useEffect(() => {
    if (current && !restoreFocusRef.current) {
      restoreFocusRef.current = document.activeElement;
    }
    if (!current && restoreFocusRef.current instanceof HTMLElement) {
      restoreFocusRef.current.focus();
      restoreFocusRef.current = null;
    }
  }, [current]);

  useEffect(() => {
    if (!current) return;
    const handleEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        settle(current.id, false);
      }
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [current, settle]);

  if (!current) return null;

  const isConfirm = current.kind === "confirm";
  const title = current.title ?? (isConfirm ? "请确认" : "提示");

  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) settle(current.id, false);
      }}
    >
      <div
        key={current.id}
        className="dialog"
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
      >
        <h2>{title}</h2>
        <p className="dialog__message">{current.message}</p>
        <div className="dialog__actions">
          {isConfirm ? (
            <Button onClick={() => settle(current.id, false)}>
              {current.cancelLabel ?? "取消"}
            </Button>
          ) : null}
          <Button
            tone={current.tone === "danger" ? "danger" : "primary"}
            autoFocus
            onClick={() => settle(current.id, true)}
          >
            {current.confirmLabel ?? (isConfirm ? "确认" : "知道了")}
          </Button>
        </div>
      </div>
    </div>
  );
}
