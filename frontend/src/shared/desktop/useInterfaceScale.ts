import { useEffect } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { create } from "zustand";

const STORAGE_KEY = "dataset-studio.interface-scale";
const MIN_SCALE = 0.8;
const MAX_SCALE = 1.5;
const SCALE_STEP = 0.1;
export const DEFAULT_INTERFACE_SCALE = 1.2;

function normalizeScale(value: number): number {
  const rounded = Math.round(value * 10) / 10;
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, rounded));
}

function readStoredScale(): number {
  if (typeof window === "undefined") return DEFAULT_INTERFACE_SCALE;
  const value = Number.parseFloat(
    window.localStorage.getItem(STORAGE_KEY) ?? String(DEFAULT_INTERFACE_SCALE),
  );
  return Number.isFinite(value) ? normalizeScale(value) : DEFAULT_INTERFACE_SCALE;
}

function applyScale(scale: number) {
  if (isTauri()) {
    void getCurrentWebview()
      .setZoom(scale)
      .catch(() => undefined);
    return;
  }

  // Keep the standalone Vite preview useful when it is opened outside Tauri.
  document.documentElement.style.setProperty("zoom", String(scale));
}

interface InterfaceScaleState {
  scale: number;
  change: (delta: number) => void;
  reset: () => void;
}

const useInterfaceScaleStore = create<InterfaceScaleState>((set) => ({
  scale: readStoredScale(),
  change: (delta) =>
    set((state) => ({
      scale: normalizeScale(state.scale + delta),
    })),
  reset: () => set({ scale: DEFAULT_INTERFACE_SCALE }),
}));

export function useApplyInterfaceScale() {
  const scale = useInterfaceScaleStore((state) => state.scale);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, String(scale));
    applyScale(scale);
  }, [scale]);
}

export function useInterfaceScale() {
  const scale = useInterfaceScaleStore((state) => state.scale);
  const change = useInterfaceScaleStore((state) => state.change);
  const reset = useInterfaceScaleStore((state) => state.reset);

  return {
    scale,
    canDecrease: scale > MIN_SCALE,
    canIncrease: scale < MAX_SCALE,
    decrease: () => change(-SCALE_STEP),
    increase: () => change(SCALE_STEP),
    reset,
  };
}
