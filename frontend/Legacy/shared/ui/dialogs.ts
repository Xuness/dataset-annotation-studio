import { create } from "zustand";

export interface DialogOptions {
  title?: string;
  tone?: "default" | "danger";
  confirmLabel?: string;
  cancelLabel?: string;
}

export interface DialogRequest extends DialogOptions {
  id: number;
  kind: "alert" | "confirm";
  message: string;
  resolve: (confirmed: boolean) => void;
}

interface DialogState {
  queue: DialogRequest[];
  push: (request: DialogRequest) => void;
  settle: (id: number, confirmed: boolean) => void;
}

let nextDialogId = 1;

export const useDialogStore = create<DialogState>((set, get) => ({
  queue: [],
  push: (request) => set((state) => ({ queue: [...state.queue, request] })),
  settle: (id, confirmed) => {
    const request = get().queue.find((item) => item.id === id);
    if (!request) return;
    set((state) => ({ queue: state.queue.filter((item) => item.id !== id) }));
    request.resolve(confirmed);
  },
}));

function enqueue(kind: DialogRequest["kind"], message: string, options: DialogOptions) {
  return new Promise<boolean>((resolve) => {
    useDialogStore.getState().push({ id: nextDialogId++, kind, message, resolve, ...options });
  });
}

export function alertDialog(
  message: string,
  options: Pick<DialogOptions, "title"> = {},
): Promise<void> {
  return enqueue("alert", message, options).then(() => undefined);
}

export function confirmDialog(message: string, options: DialogOptions = {}): Promise<boolean> {
  return enqueue("confirm", message, options);
}
