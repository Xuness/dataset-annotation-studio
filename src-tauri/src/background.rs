use std::{
    fs::{self, File, OpenOptions},
    io::{self, Read, Seek},
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use serde::Serialize;
use tauri::Manager;

const MAX_BACKGROUND_BYTES: u64 = 64 * 1024 * 1024;
const BACKGROUND_DIRECTORY: &str = "backgrounds";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CustomBackground {
    path: String,
    name: String,
}

fn detected_extension(header: &[u8]) -> Option<&'static str> {
    if header.starts_with(&[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a]) {
        return Some("png");
    }
    if header.starts_with(&[0xff, 0xd8, 0xff]) {
        return Some("jpg");
    }
    if header.len() >= 12 && &header[..4] == b"RIFF" && &header[8..12] == b"WEBP" {
        return Some("webp");
    }
    None
}

fn background_directory(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_local_data_dir()
        .map(|path| path.join(BACKGROUND_DIRECTORY))
        .map_err(|error| format!("无法定位应用数据目录：{error}"))
}

fn remove_managed_files(directory: &Path, keep: Option<&Path>) -> Result<(), String> {
    let entries = match fs::read_dir(directory) {
        Ok(entries) => entries,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(format!("无法读取背景图片目录：{error}")),
    };

    for entry in entries {
        let entry = entry.map_err(|error| format!("无法读取背景图片记录：{error}"))?;
        let path = entry.path();
        if keep.is_some_and(|kept| kept == path) || !path.is_file() {
            continue;
        }

        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name.starts_with("custom-") || name.starts_with(".custom-") {
            fs::remove_file(&path).map_err(|error| format!("无法清理旧背景图片：{error}"))?;
        }
    }
    Ok(())
}

fn install_background_file(source: &Path, directory: &Path) -> Result<PathBuf, String> {
    let metadata = fs::metadata(&source).map_err(|error| format!("无法读取所选图片：{error}"))?;
    if !metadata.is_file() {
        return Err("所选路径不是文件。".to_string());
    }
    if metadata.len() > MAX_BACKGROUND_BYTES {
        return Err("背景图片不能大于 64 MB。".to_string());
    }

    let mut input = File::open(&source).map_err(|error| format!("无法打开所选图片：{error}"))?;
    let mut header = [0_u8; 12];
    input
        .read_exact(&mut header)
        .map_err(|error| format!("无法检查图片格式：{error}"))?;
    let extension = detected_extension(&header)
        .ok_or_else(|| "仅支持有效的 PNG、JPEG 或 WebP 图片。".to_string())?;

    fs::create_dir_all(&directory).map_err(|error| format!("无法创建背景图片目录：{error}"))?;
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| format!("系统时间异常：{error}"))?
        .as_nanos();
    let file_name = format!("custom-{timestamp}.{extension}");
    let destination = directory.join(&file_name);
    let temporary = directory.join(format!(".{file_name}.tmp"));

    input
        .rewind()
        .map_err(|error| format!("无法重新读取所选图片：{error}"))?;
    let copy_result = (|| -> Result<(), io::Error> {
        let mut output = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temporary)?;
        io::copy(&mut input, &mut output)?;
        output.sync_all()?;
        fs::rename(&temporary, &destination)
    })();
    if let Err(error) = copy_result {
        let _ = fs::remove_file(&temporary);
        return Err(format!("无法保存背景图片：{error}"));
    }

    // The new image is already durable at this point. Failure to remove a
    // stale managed file must not invalidate the new selection or strand the
    // preference on a path that was just deleted.
    let _ = remove_managed_files(&directory, Some(&destination));

    Ok(destination)
}

fn install_background(
    app: &tauri::AppHandle,
    source_path: &str,
) -> Result<CustomBackground, String> {
    let source = PathBuf::from(source_path);
    let directory = background_directory(app)?;
    let destination = install_background_file(&source, &directory)?;

    let source_name = source
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("自定义背景")
        .to_string();
    Ok(CustomBackground {
        path: destination.to_string_lossy().into_owned(),
        name: source_name,
    })
}

#[tauri::command]
pub(crate) async fn install_custom_background(
    app: tauri::AppHandle,
    source_path: String,
) -> Result<CustomBackground, String> {
    tauri::async_runtime::spawn_blocking(move || install_background(&app, &source_path))
        .await
        .map_err(|error| format!("保存背景图片的任务意外终止：{error}"))?
}

#[tauri::command]
pub(crate) async fn clear_custom_background(app: tauri::AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let directory = background_directory(&app)?;
        remove_managed_files(&directory, None)
    })
    .await
    .map_err(|error| format!("清理背景图片的任务意外终止：{error}"))?
}

#[cfg(test)]
mod tests {
    use std::{fs, time::SystemTime};

    use super::{detected_extension, install_background_file};

    #[test]
    fn recognizes_supported_raster_signatures() {
        assert_eq!(
            detected_extension(&[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a]),
            Some("png")
        );
        assert_eq!(detected_extension(&[0xff, 0xd8, 0xff, 0xe0]), Some("jpg"));
        assert_eq!(
            detected_extension(b"RIFF\x10\x00\x00\x00WEBP"),
            Some("webp")
        );
    }

    #[test]
    fn rejects_extension_only_or_unsupported_files() {
        assert_eq!(detected_extension(b"not really a png"), None);
        assert_eq!(detected_extension(b"GIF89a"), None);
    }

    #[test]
    fn installs_atomically_and_removes_only_old_managed_backgrounds() {
        let unique = SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("test clock is before the Unix epoch")
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "dataset-studio-background-test-{}-{unique}",
            std::process::id()
        ));
        let managed = root.join("backgrounds");
        let source = root.join("source.png");
        let old_managed = managed.join("custom-old.png");
        let unrelated = managed.join("keep-me.txt");
        fs::create_dir_all(&managed).expect("failed to create test directory");
        let image_bytes = [
            0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 1, 2, 3, 4,
        ];
        fs::write(&source, image_bytes).expect("failed to write source image");
        fs::write(&old_managed, image_bytes).expect("failed to write old managed image");
        fs::write(&unrelated, b"unrelated").expect("failed to write unrelated file");

        let installed = install_background_file(&source, &managed)
            .expect("failed to install managed background");

        assert_eq!(
            fs::read(&installed).expect("failed to read installed image"),
            image_bytes
        );
        assert!(!old_managed.exists());
        assert!(unrelated.exists());
        fs::remove_dir_all(&root).expect("failed to clean test directory");
    }
}
