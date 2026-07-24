#[cfg(not(debug_assertions))]
use std::sync::Mutex;

#[cfg(not(debug_assertions))]
use tauri::Manager;
#[cfg(not(debug_assertions))]
use tauri_plugin_shell::{process::CommandChild, ShellExt};

mod background;
mod clipboard;
mod desktop;

const LINUX_GRAPHICS_MODE_ENV: &str = "DATASET_STUDIO_LINUX_GRAPHICS";

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
enum LinuxGraphicsMode {
    #[default]
    Default,
    NvidiaSync,
    DmabufOff,
    Software,
}

impl LinuxGraphicsMode {
    fn as_str(self) -> &'static str {
        match self {
            Self::Default => "default",
            Self::NvidiaSync => "nvidia-sync",
            Self::DmabufOff => "dmabuf-off",
            Self::Software => "software",
        }
    }
}

fn parse_linux_graphics_mode(value: Option<&str>) -> LinuxGraphicsMode {
    match value.map(str::trim).map(str::to_ascii_lowercase).as_deref() {
        None | Some("") | Some("default") => LinuxGraphicsMode::Default,
        Some("nvidia-sync") => LinuxGraphicsMode::NvidiaSync,
        Some("dmabuf-off") => LinuxGraphicsMode::DmabufOff,
        Some("software") => LinuxGraphicsMode::Software,
        Some(value) => {
            eprintln!("Dataset Studio: ignoring unknown {LINUX_GRAPHICS_MODE_ENV} value {value:?}");
            LinuxGraphicsMode::Default
        }
    }
}

#[cfg(target_os = "linux")]
fn set_env_if_missing(name: &str, value: &str) {
    if std::env::var_os(name).is_none() {
        std::env::set_var(name, value);
    }
}

fn configure_linux_graphics_environment(mode: LinuxGraphicsMode) {
    #[cfg(target_os = "linux")]
    match mode {
        LinuxGraphicsMode::Default => {}
        LinuxGraphicsMode::NvidiaSync => {
            set_env_if_missing("__NV_DISABLE_EXPLICIT_SYNC", "1");
        }
        LinuxGraphicsMode::DmabufOff => {
            set_env_if_missing("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        }
        LinuxGraphicsMode::Software => {
            set_env_if_missing("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
            set_env_if_missing("WEBKIT_DISABLE_COMPOSITING_MODE", "1");
        }
    }

    #[cfg(not(target_os = "linux"))]
    let _ = mode;
}

fn runtime_platform_name() -> &'static str {
    if cfg!(target_os = "linux") {
        "linux"
    } else if cfg!(target_os = "macos") {
        "macos"
    } else if cfg!(target_os = "windows") {
        "windows"
    } else {
        "other"
    }
}

fn runtime_initialization_script(mode: LinuxGraphicsMode) -> String {
    format!(
        "document.documentElement.dataset.runtimePlatform={:?};\
         document.documentElement.dataset.linuxGraphicsMode={:?};",
        runtime_platform_name(),
        mode.as_str()
    )
}

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
    let graphics_mode =
        parse_linux_graphics_mode(std::env::var(LINUX_GRAPHICS_MODE_ENV).ok().as_deref());
    configure_linux_graphics_environment(graphics_mode);

    let builder = tauri::Builder::default()
        .append_invoke_initialization_script(runtime_initialization_script(graphics_mode))
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            desktop::show_main_window(app);
        }));

    let builder = builder
        .invoke_handler(tauri::generate_handler![
            clipboard::write_clipboard_text_with_history,
            background::install_custom_background,
            background::clear_custom_background,
            desktop::exit_application
        ])
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .on_window_event(desktop::handle_window_event);

    #[cfg(not(debug_assertions))]
    let builder = builder.manage(ServiceProcess::default());

    let builder = builder.setup(|app| {
        desktop::setup(app)?;
        #[cfg(not(debug_assertions))]
        {
            let (mut events, child) = app.shell().sidecar("dataset-studio-service")?.spawn()?;
            *app.state::<ServiceProcess>()
                .0
                .lock()
                .expect("service lock poisoned") = Some(child);
            tauri::async_runtime::spawn(async move { while events.recv().await.is_some() {} });
        }
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

#[cfg(test)]
mod tests {
    use super::{
        parse_linux_graphics_mode, runtime_initialization_script, runtime_platform_name,
        LinuxGraphicsMode,
    };

    #[test]
    fn linux_graphics_modes_are_explicit_and_unknown_values_are_safe() {
        assert_eq!(parse_linux_graphics_mode(None), LinuxGraphicsMode::Default);
        assert_eq!(
            parse_linux_graphics_mode(Some("nvidia-sync")),
            LinuxGraphicsMode::NvidiaSync
        );
        assert_eq!(
            parse_linux_graphics_mode(Some("DMABUF-OFF")),
            LinuxGraphicsMode::DmabufOff
        );
        assert_eq!(
            parse_linux_graphics_mode(Some(" software ")),
            LinuxGraphicsMode::Software
        );
        assert_eq!(
            parse_linux_graphics_mode(Some("unexpected")),
            LinuxGraphicsMode::Default
        );
        let script = runtime_initialization_script(LinuxGraphicsMode::Software);
        assert!(script.contains(&format!(
            "dataset.runtimePlatform={:?}",
            runtime_platform_name()
        )));
        assert!(script.contains("dataset.linuxGraphicsMode=\"software\""));
    }
}
