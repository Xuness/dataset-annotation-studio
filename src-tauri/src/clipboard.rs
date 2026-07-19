#[tauri::command]
pub(crate) fn write_clipboard_text_with_history(text: String) -> Result<bool, String> {
    if text.is_empty() {
        return Ok(false);
    }

    #[cfg(target_os = "windows")]
    {
        write_windows_clipboard_text_with_history(&text)
    }

    #[cfg(not(target_os = "windows"))]
    {
        // The WebView keeps handling the clipboard normally on other platforms.
        let _ = text;
        Ok(true)
    }
}

#[cfg(target_os = "windows")]
fn write_windows_clipboard_text_with_history(text: &str) -> Result<bool, String> {
    use windows::{
        core::HSTRING,
        ApplicationModel::DataTransfer::{Clipboard, ClipboardContentOptions, DataPackage},
    };

    let content = DataPackage::new()
        .map_err(|error| format!("failed to create clipboard content: {error}"))?;
    content
        .SetText(&HSTRING::from(text))
        .map_err(|error| format!("failed to set clipboard text: {error}"))?;

    let options = ClipboardContentOptions::new()
        .map_err(|error| format!("failed to create clipboard options: {error}"))?;
    options
        .SetIsAllowedInHistory(true)
        .map_err(|error| format!("failed to enable clipboard history: {error}"))?;

    let written = Clipboard::SetContentWithOptions(&content, &options)
        .map_err(|error| format!("failed to write clipboard content: {error}"))?;
    if written {
        Clipboard::Flush()
            .map_err(|error| format!("failed to persist clipboard content: {error}"))?;
    }

    Ok(written)
}

#[cfg(test)]
mod tests {
    #[test]
    fn empty_text_is_not_written() {
        assert_eq!(
            super::write_clipboard_text_with_history(String::new()),
            Ok(false)
        );
    }

    #[cfg(target_os = "windows")]
    fn clipboard_history_contains(expected: &str) -> windows::core::Result<bool> {
        use windows::ApplicationModel::DataTransfer::{
            Clipboard, ClipboardHistoryItemsResultStatus, StandardDataFormats,
        };

        let result = Clipboard::GetHistoryItemsAsync()?.get()?;
        if result.Status()? != ClipboardHistoryItemsResultStatus::Success {
            return Ok(false);
        }

        let text_format = StandardDataFormats::Text()?;
        let items = result.Items()?;
        for index in 0..items.Size()? {
            let content = items.GetAt(index)?.Content()?;
            if content.Contains(&text_format)?
                && content.GetTextAsync()?.get()?.to_string() == expected
            {
                return Ok(true);
            }
        }

        Ok(false)
    }

    #[cfg(target_os = "windows")]
    #[test]
    #[ignore = "writes a temporary marker to the real Windows clipboard history"]
    fn writes_text_to_windows_clipboard_history() {
        use std::{
            thread,
            time::{Duration, SystemTime, UNIX_EPOCH},
        };
        use windows::{
            ApplicationModel::DataTransfer::Clipboard,
            Win32::System::WinRT::{RoInitialize, RoUninitialize, RO_INIT_SINGLETHREADED},
        };

        thread::spawn(|| {
            struct ApartmentGuard;

            impl Drop for ApartmentGuard {
                fn drop(&mut self) {
                    unsafe { RoUninitialize() };
                }
            }

            // Clipboard WinRT classes require a single-threaded apartment,
            // matching the Tauri UI thread used by the real command.
            unsafe { RoInitialize(RO_INIT_SINGLETHREADED) }
                .expect("failed to initialize the test STA");
            let _apartment = ApartmentGuard;

            assert!(
                Clipboard::IsHistoryEnabled().expect("failed to read clipboard history setting"),
                "Windows clipboard history is disabled"
            );

            let timestamp = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system clock is before the Unix epoch")
                .as_nanos();
            let marker = format!("dataset-studio-clipboard-history-smoke-{timestamp}");
            assert!(super::write_windows_clipboard_text_with_history(&marker)
                .expect("failed to write the clipboard marker"));

            for _ in 0..10 {
                if clipboard_history_contains(&marker).expect("failed to read clipboard history") {
                    return;
                }
                thread::sleep(Duration::from_millis(50));
            }

            panic!("the clipboard marker was not found in Windows clipboard history");
        })
        .join()
        .expect("clipboard history smoke-test thread panicked");
    }
}
