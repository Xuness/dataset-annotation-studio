import { useLayoutEffect, useRef } from "react";

import { Button } from "./Button";
import { useDialogStore } from "./dialogs";

export function DialogHost() {
  const current = useDialogStore((state) => state.queue[0] ?? null);
  const settle = useDialogStore((state) => state.settle);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  useLayoutEffect(() => {
    if (!current) {
      const restoreFocus = restoreFocusRef.current;
      restoreFocusRef.current = null;
      if (restoreFocus?.isConnected) restoreFocus.focus();
      return;
    }

    if (!restoreFocusRef.current && document.activeElement instanceof HTMLElement) {
      restoreFocusRef.current = document.activeElement;
    }

    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();

    const initialFocusSelector =
      current.kind === "confirm" ? "[data-dialog-cancel]" : "[data-dialog-confirm]";
    dialog.querySelector<HTMLButtonElement>(initialFocusSelector)?.focus();
  }, [current]);

  if (!current) return null;

  const isConfirm = current.kind === "confirm";
  const title = current.title ?? (isConfirm ? "请确认" : "提示");
  const titleId = `dialog-title-${current.id}`;
  const messageId = `dialog-message-${current.id}`;

  return (
    <dialog
      key={current.id}
      ref={dialogRef}
      className="dialog-backdrop"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={messageId}
      onCancel={(event) => {
        event.preventDefault();
        settle(current.id, false);
      }}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape") {
          event.preventDefault();
          settle(current.id, false);
        }
      }}
      onMouseDown={(event) => {
        if (event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        const outsideDialog =
          event.clientX < bounds.left ||
          event.clientX > bounds.right ||
          event.clientY < bounds.top ||
          event.clientY > bounds.bottom;
        if (outsideDialog) settle(current.id, false);
      }}
    >
      <div className="dialog">
        <h2 id={titleId}>{title}</h2>
        <p id={messageId} className="dialog__message">
          {current.message}
        </p>
        <div className="dialog__actions">
          {isConfirm ? (
            <Button data-dialog-cancel="" onClick={() => settle(current.id, false)}>
              {current.cancelLabel ?? "取消"}
            </Button>
          ) : null}
          <Button
            data-dialog-confirm=""
            tone={current.tone === "danger" ? "danger" : "primary"}
            onClick={() => settle(current.id, true)}
          >
            {current.confirmLabel ?? (isConfirm ? "确认" : "知道了")}
          </Button>
        </div>
      </div>
    </dialog>
  );
}
