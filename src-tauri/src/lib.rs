#[cfg(not(debug_assertions))]
use std::sync::Mutex;

#[cfg(not(debug_assertions))]
use tauri::Manager;
#[cfg(not(debug_assertions))]
use tauri_plugin_shell::{process::CommandChild, ShellExt};

#[cfg(not(debug_assertions))]
#[derive(Default)]
struct ServiceProcess(Mutex<Option<CommandChild>>);

#[cfg(all(not(debug_assertions), target_os = "windows"))]
fn terminate_service(child: CommandChild) {
    use std::os::windows::process::CommandExt;
    use std::process::Command;

    const CREATE_NO_WINDOW: u32 = 0x08000000;
    let status = Command::new("taskkill")
        .args(["/PID", &child.pid().to_string(), "/T", "/F"])
        .creation_flags(CREATE_NO_WINDOW)
        .status();
    if status.is_err() || status.is_ok_and(|value| !value.success()) {
        let _ = child.kill();
    }
}

#[cfg(all(not(debug_assertions), not(target_os = "windows")))]
fn terminate_service(child: CommandChild) {
    let _ = child.kill();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init());

    #[cfg(not(debug_assertions))]
    let builder = builder.manage(ServiceProcess::default()).setup(|app| {
        let (mut events, child) = app.shell().sidecar("dataset-studio-service")?.spawn()?;
        *app.state::<ServiceProcess>()
            .0
            .lock()
            .expect("service lock poisoned") = Some(child);
        tauri::async_runtime::spawn(async move { while events.recv().await.is_some() {} });
        Ok(())
    });

    let application = builder
        .build(tauri::generate_context!())
        .expect("failed to build Dataset Annotation Studio");
    application.run(|_app, _event| {
        #[cfg(not(debug_assertions))]
        if matches!(_event, tauri::RunEvent::Exit) {
            if let Some(child) = _app
                .state::<ServiceProcess>()
                .0
                .lock()
                .expect("service lock poisoned")
                .take()
            {
                terminate_service(child);
            }
        }
    });
}
