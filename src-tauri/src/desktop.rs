use std::{
    path::{Path, PathBuf},
    sync::Mutex,
    thread,
    time::Duration,
};

use serde::Serialize;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    App, AppHandle, Emitter, Manager, Runtime, Window, WindowEvent,
};
use tauri_plugin_opener::OpenerExt;

const MAIN_WINDOW_LABEL: &str = "main";
const SHOW_MENU_ID: &str = "show-main-window";
const EXIT_MENU_ID: &str = "request-application-exit";
pub(crate) const EXIT_REQUESTED_EVENT: &str = "desktop-exit-requested";
const EXIT_REQUEST_FALLBACK_DELAY: Duration = Duration::from_secs(3);

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
struct ExitRequestPayload {
    request_id: u64,
}

#[derive(Debug, Default)]
struct ExitRequestState {
    next_request_id: u64,
    pending_request_id: Option<u64>,
}

#[derive(Debug, Default)]
pub(crate) struct ExitRequestFallback(Mutex<ExitRequestState>);

impl ExitRequestFallback {
    fn begin_request(&self) -> (u64, bool) {
        let mut state = self.0.lock().expect("exit request state poisoned");
        if let Some(request_id) = state.pending_request_id {
            return (request_id, false);
        }

        state.next_request_id = state
            .next_request_id
            .checked_add(1)
            .expect("exit request id exhausted");
        let request_id = state.next_request_id;
        state.pending_request_id = Some(request_id);
        (request_id, true)
    }

    fn acknowledge(&self, request_id: u64) -> bool {
        let mut state = self.0.lock().expect("exit request state poisoned");
        if state.pending_request_id != Some(request_id) {
            return false;
        }
        state.pending_request_id = None;
        true
    }

    fn take_pending(&self, request_id: u64) -> bool {
        self.acknowledge(request_id)
    }
}

#[derive(Debug, PartialEq, Eq)]
enum TrayMenuAction {
    Show,
    RequestExit,
    Ignore,
}

fn tray_menu_action(id: &str) -> TrayMenuAction {
    match id {
        SHOW_MENU_ID => TrayMenuAction::Show,
        EXIT_MENU_ID => TrayMenuAction::RequestExit,
        _ => TrayMenuAction::Ignore,
    }
}

pub(crate) fn show_main_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn schedule_exit_fallback<R: Runtime + 'static>(app: AppHandle<R>, request_id: u64) {
    let result = thread::Builder::new()
        .name("dataset-studio-exit-fallback".to_owned())
        .spawn(move || {
            thread::sleep(EXIT_REQUEST_FALLBACK_DELAY);
            if app.state::<ExitRequestFallback>().take_pending(request_id) {
                app.exit(0);
            }
        });
    if let Err(error) = result {
        eprintln!("Dataset Studio: failed to start native exit fallback: {error}");
    }
}

fn request_application_exit<R: Runtime + 'static>(app: &AppHandle<R>) {
    show_main_window(app);
    let (request_id, should_schedule_fallback) = app.state::<ExitRequestFallback>().begin_request();
    let _ = app.emit(EXIT_REQUESTED_EVENT, ExitRequestPayload { request_id });
    if should_schedule_fallback {
        schedule_exit_fallback(app.clone(), request_id);
    }
}

pub(crate) fn setup<R: Runtime + 'static>(app: &App<R>) -> tauri::Result<()> {
    #[cfg(target_os = "linux")]
    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        window.set_decorations(true)?;
    }

    let show_item =
        MenuItem::with_id(app, SHOW_MENU_ID, "打开 Dataset Studio", true, None::<&str>)?;
    let exit_item = MenuItem::with_id(app, EXIT_MENU_ID, "退出", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show_item, &exit_item])?;

    let tray = TrayIconBuilder::with_id("dataset-studio-tray")
        .tooltip("Dataset Studio")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match tray_menu_action(event.id().as_ref()) {
            TrayMenuAction::Show => show_main_window(app),
            TrayMenuAction::RequestExit => request_application_exit(app),
            TrayMenuAction::Ignore => {}
        })
        .on_tray_icon_event(|tray, event| {
            if matches!(
                event,
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                }
            ) {
                show_main_window(tray.app_handle());
            }
        });

    let tray = if let Some(icon) = app.default_window_icon() {
        tray.icon(icon.clone())
    } else {
        tray
    };
    let tray_result = tray.build(app);
    #[cfg(target_os = "linux")]
    let _ = tray_result;
    #[cfg(not(target_os = "linux"))]
    tray_result?;
    Ok(())
}

pub(crate) fn handle_window_event<R: Runtime + 'static>(window: &Window<R>, event: &WindowEvent) {
    if window.label() != MAIN_WINDOW_LABEL {
        return;
    }
    if let WindowEvent::CloseRequested { api, .. } = event {
        api.prevent_close();
        #[cfg(target_os = "linux")]
        request_application_exit(window.app_handle());
        #[cfg(not(target_os = "linux"))]
        let _ = window.hide();
    }
}

fn existing_directory(path: &Path) -> Result<PathBuf, String> {
    if path.as_os_str().is_empty() {
        return Err("目录路径不能为空。".to_owned());
    }
    let metadata =
        std::fs::metadata(path).map_err(|error| format!("目录不存在或无法访问：{error}"))?;
    if !metadata.is_dir() {
        return Err("目标路径不是目录。".to_owned());
    }
    Ok(path.to_path_buf())
}

#[tauri::command]
pub(crate) fn open_directory(app: AppHandle, path: PathBuf) -> Result<(), String> {
    let directory = existing_directory(&path)?;
    app.opener()
        .open_path(directory.to_string_lossy().into_owned(), None::<&str>)
        .map_err(|error| format!("无法调用系统文件管理器：{error}"))
}

#[tauri::command]
pub(crate) fn exit_application(app: AppHandle) {
    app.exit(0);
}

#[tauri::command]
pub(crate) fn acknowledge_exit_request(app: AppHandle, request_id: u64) -> bool {
    app.state::<ExitRequestFallback>().acknowledge(request_id)
}

#[cfg(test)]
mod tests {
    use super::{
        existing_directory, tray_menu_action, ExitRequestFallback, TrayMenuAction, EXIT_MENU_ID,
        EXIT_REQUESTED_EVENT, SHOW_MENU_ID,
    };
    use std::path::Path;

    #[test]
    fn tray_menu_ids_map_to_explicit_lifecycle_actions() {
        assert_eq!(tray_menu_action(SHOW_MENU_ID), TrayMenuAction::Show);
        assert_eq!(tray_menu_action(EXIT_MENU_ID), TrayMenuAction::RequestExit);
        assert_eq!(tray_menu_action("unknown"), TrayMenuAction::Ignore);
        assert_eq!(EXIT_REQUESTED_EVENT, "desktop-exit-requested");
    }

    #[test]
    fn directory_opening_rejects_files_and_missing_paths() {
        let current = std::env::current_dir().expect("current directory should exist");
        assert_eq!(existing_directory(&current), Ok(current));
        assert!(existing_directory(Path::new(file!())).is_err());
        assert!(existing_directory(Path::new("definitely-missing-directory")).is_err());
    }

    #[test]
    fn exit_fallback_tracks_current_request_and_rejects_stale_acknowledgements() {
        let fallback = ExitRequestFallback::default();

        let (first_request, should_schedule) = fallback.begin_request();
        assert_eq!(first_request, 1);
        assert!(should_schedule);
        assert_eq!(fallback.begin_request(), (first_request, false));
        assert!(!fallback.acknowledge(first_request + 1));
        assert!(fallback.acknowledge(first_request));
        assert!(!fallback.take_pending(first_request));

        let (second_request, should_schedule) = fallback.begin_request();
        assert_eq!(second_request, first_request + 1);
        assert!(should_schedule);
        assert!(!fallback.acknowledge(first_request));
        assert!(fallback.take_pending(second_request));
    }
}
