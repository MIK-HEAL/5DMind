import { runtimeTarget } from "./runtime";

export function fullscreenSupported() {
  if (runtimeTarget === "desktop") return true;
  return typeof document !== "undefined" && Boolean(document.fullscreenEnabled);
}

export async function isFullscreen() {
  if (runtimeTarget === "desktop") {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    return getCurrentWindow().isFullscreen();
  }
  return typeof document !== "undefined" && Boolean(document.fullscreenElement);
}

export async function setFullscreen(fullscreen: boolean) {
  if (runtimeTarget === "desktop") {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().setFullscreen(fullscreen);
    return;
  }

  if (fullscreen) {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
  } else if (document.fullscreenElement) {
    await document.exitFullscreen();
  }
}

export async function subscribeFullscreen(onChange: (fullscreen: boolean) => void) {
  if (runtimeTarget === "desktop") {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const currentWindow = getCurrentWindow();
    const sync = () => {
      void isFullscreen().then(onChange);
    };
    const [unlistenResize, unlistenFocus] = await Promise.all([
      currentWindow.onResized(sync),
      currentWindow.onFocusChanged(sync),
    ]);
    return () => {
      unlistenResize();
      unlistenFocus();
    };
  }

  const sync = () => onChange(Boolean(document.fullscreenElement));
  document.addEventListener("fullscreenchange", sync);
  return () => document.removeEventListener("fullscreenchange", sync);
}
