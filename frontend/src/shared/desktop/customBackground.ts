import { invoke, isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

import type { CustomBackground } from "../theme/appearance";

const INSTALL_COMMAND = "install_custom_background";
const CLEAR_COMMAND = "clear_custom_background";

export function supportsCustomBackgrounds(): boolean {
  return isTauri();
}

export async function chooseCustomBackground(): Promise<CustomBackground | null> {
  if (!isTauri()) {
    throw new Error("自定义背景图片仅在 Dataset Studio 桌面版中可用。");
  }

  const selected = await open({
    title: "选择自定义背景图片",
    directory: false,
    multiple: false,
    filters: [{ name: "背景图片", extensions: ["png", "jpg", "jpeg", "webp"] }],
  });
  if (typeof selected !== "string") return null;

  return invoke<CustomBackground>(INSTALL_COMMAND, { sourcePath: selected });
}

export async function clearCustomBackground(): Promise<void> {
  if (!isTauri()) return;
  await invoke(CLEAR_COMMAND);
}
