export type RuntimePlatform = "linux" | "macos" | "windows" | "other";
export type LinuxGraphicsMode = "default" | "nvidia-sync" | "cpu-paint" | "dmabuf-off" | "software";

const LINUX_GRAPHICS_MODES = new Set<LinuxGraphicsMode>([
  "default",
  "nvidia-sync",
  "cpu-paint",
  "dmabuf-off",
  "software",
]);
const RUNTIME_PLATFORMS = new Set<RuntimePlatform>(["linux", "macos", "windows", "other"]);

export function detectRuntimePlatform(userAgent: string, navigatorPlatform = ""): RuntimePlatform {
  const fingerprint = `${userAgent} ${navigatorPlatform}`;
  if (/(Linux|X11)/i.test(fingerprint)) return "linux";
  if (/(Macintosh|MacIntel|MacPPC|Mac68K)/i.test(fingerprint)) return "macos";
  if (/(Windows|Win32|Win64|WOW64)/i.test(fingerprint)) return "windows";
  return "other";
}

export function getRuntimePlatform(): RuntimePlatform {
  const detectedPlatform =
    typeof navigator === "undefined"
      ? "other"
      : detectRuntimePlatform(navigator.userAgent, navigator.platform);
  if (typeof document === "undefined") return detectedPlatform;
  return normalizeRuntimePlatform(
    document.documentElement.dataset.runtimePlatform,
    detectedPlatform,
  );
}

export function normalizeRuntimePlatform(
  value: string | undefined,
  fallback: RuntimePlatform,
): RuntimePlatform {
  return value && RUNTIME_PLATFORMS.has(value as RuntimePlatform)
    ? (value as RuntimePlatform)
    : fallback;
}

export function normalizeLinuxGraphicsMode(value: string | undefined): LinuxGraphicsMode {
  return value && LINUX_GRAPHICS_MODES.has(value as LinuxGraphicsMode)
    ? (value as LinuxGraphicsMode)
    : "default";
}

export function initializeRuntimePlatform(): RuntimePlatform {
  const detectedPlatform = getRuntimePlatform();
  if (typeof document === "undefined") return detectedPlatform;

  const root = document.documentElement;
  const platform = normalizeRuntimePlatform(root.dataset.runtimePlatform, detectedPlatform);
  root.dataset.runtimePlatform = platform;
  if (platform === "linux") {
    root.dataset.linuxGraphicsMode = normalizeLinuxGraphicsMode(root.dataset.linuxGraphicsMode);
  } else {
    delete root.dataset.linuxGraphicsMode;
  }
  return platform;
}

export function usesNativeWindowDecorations(platform = getRuntimePlatform()): boolean {
  return platform === "linux";
}

export function usesNativeDesktopWindowDecorations(
  desktopRuntime: boolean,
  platform = getRuntimePlatform(),
): boolean {
  return desktopRuntime && usesNativeWindowDecorations(platform);
}

export function filterTransparentRegionsForWindowDecorations<Region extends string>(
  regions: readonly Region[],
  nativeWindowDecorations: boolean,
): Region[] {
  return nativeWindowDecorations
    ? regions.filter((region) => region !== "desktop-titlebar")
    : [...regions];
}
