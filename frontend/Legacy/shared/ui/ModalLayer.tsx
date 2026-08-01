import { useLayoutEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

const activeModalLayers: symbol[] = [];

interface ModalLayerProps {
  open: boolean;
  onClose: () => void;
  backdropClassName: string;
  panelClassName: string;
  labelledBy: string;
  initialFocusSelector?: string;
  children: ReactNode;
}

export function ModalLayer({
  open,
  onClose,
  backdropClassName,
  panelClassName,
  labelledBy,
  initialFocusSelector,
  children,
}: ModalLayerProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const layerIdRef = useRef(Symbol("modal-layer"));
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useLayoutEffect(() => {
    if (!open) return;

    if (document.activeElement instanceof HTMLElement) {
      restoreFocusRef.current = document.activeElement;
    }

    const panel = panelRef.current;
    const layerId = layerIdRef.current;
    activeModalLayers.push(layerId);
    const initialFocus = initialFocusSelector
      ? panel?.querySelector<HTMLElement>(initialFocusSelector)
      : panel?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
    (initialFocus ?? panel)?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (
        activeModalLayers.at(-1) !== layerId ||
        document.querySelector<HTMLDialogElement>("dialog[open]")
      ) {
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !panel) return;

      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (element) => !element.hasAttribute("disabled") && element.offsetParent !== null,
      );
      if (!focusable.length) {
        event.preventDefault();
        panel.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
      const layerIndex = activeModalLayers.lastIndexOf(layerId);
      if (layerIndex >= 0) activeModalLayers.splice(layerIndex, 1);
      const restoreFocus = restoreFocusRef.current;
      restoreFocusRef.current = null;
      if (restoreFocus?.isConnected) restoreFocus.focus();
    };
  }, [initialFocusSelector, open]);

  if (!open) return null;

  return createPortal(
    <div
      className={backdropClassName}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCloseRef.current();
      }}
    >
      <div
        ref={panelRef}
        className={panelClassName}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
