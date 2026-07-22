fn main() {
    // Tauri embeds this resource into the Windows executable. Cargo otherwise
    // may reuse the previous EXE after an icon-only regeneration.
    println!("cargo:rerun-if-changed=icons/icon.ico");
    tauri_build::build()
}
