use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    App, AppHandle, Emitter, Manager, Runtime, Window, WindowEvent,
};

const MAIN_WINDOW_LABEL: &str = "main";
const SHOW_MENU_ID: &str = "show-main-window";
const EXIT_MENU_ID: &str = "request-application-exit";
pub(crate) const EXIT_REQUESTED_EVENT: &str = "desktop-exit-requested";

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

fn request_application_exit<R: Runtime>(app: &AppHandle<R>) {
    show_main_window(app);
    let _ = app.emit(EXIT_REQUESTED_EVENT, ());
}

pub(crate) fn setup<R: Runtime>(app: &App<R>) -> tauri::Result<()> {
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

pub(crate) fn handle_window_event<R: Runtime>(window: &Window<R>, event: &WindowEvent) {
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

#[tauri::command]
pub(crate) fn exit_application(app: AppHandle) {
    app.exit(0);
}

#[cfg(test)]
mod tests {
    use super::{
        tray_menu_action, TrayMenuAction, EXIT_MENU_ID, EXIT_REQUESTED_EVENT, SHOW_MENU_ID,
    };

    #[test]
    fn tray_menu_ids_map_to_explicit_lifecycle_actions() {
        assert_eq!(tray_menu_action(SHOW_MENU_ID), TrayMenuAction::Show);
        assert_eq!(tray_menu_action(EXIT_MENU_ID), TrayMenuAction::RequestExit);
        assert_eq!(tray_menu_action("unknown"), TrayMenuAction::Ignore);
        assert_eq!(EXIT_REQUESTED_EVENT, "desktop-exit-requested");
    }
}
