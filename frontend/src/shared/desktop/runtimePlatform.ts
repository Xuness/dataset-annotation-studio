export type RuntimePlatform = "linux" | "macos" | "windows" | "other";

export function detectRuntimePlatform(userAgent: string, navigatorPlatform = ""): RuntimePlatform {
  const fingerprint = `${userAgent} ${navigatorPlatform}`;
  if (/(Linux|X11)/i.test(fingerprint)) return "linux";
  if (/(Macintosh|MacIntel|MacPPC|Mac68K)/i.test(fingerprint)) return "macos";
  if (/(Windows|Win32|Win64|WOW64)/i.test(fingerprint)) return "windows";
  return "other";
}

export function getRuntimePlatform(): RuntimePlatform {
  if (typeof navigator === "undefined") return "other";
  return detectRuntimePlatform(navigator.userAgent, navigator.platform);
}

export function initializeRuntimePlatform(): RuntimePlatform {
  const platform = getRuntimePlatform();
  if (typeof document !== "undefined") {
    document.documentElement.dataset.runtimePlatform = platform;
  }
  return platform;
}

export function usesNativeWindowDecorations(platform = getRuntimePlatform()): boolean {
  return platform === "linux";
}
