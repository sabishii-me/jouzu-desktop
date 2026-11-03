use base64::{engine::general_purpose::STANDARD, Engine};
use std::path::{Path, PathBuf};

const MAX_IMAGE_BYTES: u64 = 10 * 1024 * 1024;
/// A text preview is bounded and only reads inside the session workspace.
const MAX_PREVIEW_BYTES: u64 = 1024 * 1024;

/// Resolve `path` against `workspace` and refuse anything outside it.
fn inside_workspace(workspace: &str, path: &str) -> Result<PathBuf, String> {
    let root = std::fs::canonicalize(workspace).map_err(|_| "The workspace folder is unavailable.".to_string())?;
    let candidate = Path::new(path);
    let joined = if candidate.is_absolute() { candidate.to_path_buf() } else { root.join(candidate) };
    let resolved = std::fs::canonicalize(&joined).map_err(|_| "That file no longer exists.".to_string())?;
    if !resolved.starts_with(&root) {
        return Err("That file is outside the workspace.".into());
    }
    if !resolved.is_file() {
        return Err("That path is not a file.".into());
    }
    Ok(resolved)
}

/// Read one workspace file for the turn-summary preview (0080). Binary and
/// oversized files are reported, never returned as mojibake.
#[tauri::command]
pub fn workspace_read(path: String, workspace: String) -> Result<serde_json::Value, String> {
    let file = inside_workspace(&workspace, &path)?;
    let metadata = std::fs::metadata(&file).map_err(|_| "That file no longer exists.".to_string())?;
    if metadata.len() > MAX_PREVIEW_BYTES {
        return Ok(serde_json::json!({
            "binary": false,
            "truncated": true,
            "bytes": metadata.len(),
            "text": "",
        }));
    }
    let bytes = std::fs::read(&file).map_err(|_| "That file could not be read.".to_string())?;
    match String::from_utf8(bytes) {
        Ok(text) => Ok(serde_json::json!({
            "binary": false,
            "truncated": false,
            "bytes": metadata.len(),
            "text": text,
        })),
        Err(_) => Ok(serde_json::json!({
            "binary": true,
            "truncated": false,
            "bytes": metadata.len(),
            "text": "",
        })),
    }
}

/// Read an image path supplied by the native drag/drop event. The frontend still
/// validates the signature before attaching it to a message.
#[tauri::command]
pub fn read_dropped_image(path: String) -> Result<serde_json::Value, String> {
    let path = Path::new(&path);
    let metadata = std::fs::metadata(path).map_err(|_| "Dropped image is unavailable.")?;
    if !metadata.is_file() {
        return Err("Dropped item is not a file.".into());
    }
    if metadata.len() == 0 || metadata.len() > MAX_IMAGE_BYTES {
        return Err("Dropped image must be between 1 byte and 10 MB.".into());
    }
    let mime = match path.extension().and_then(|value| value.to_str()).map(|value| value.to_ascii_lowercase()).as_deref() {
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("webp") => "image/webp",
        Some("gif") => "image/gif",
        _ => return Err("Dropped file is not a supported image.".into()),
    };
    let bytes = std::fs::read(path).map_err(|_| "Dropped image could not be read.")?;
    let name = path.file_name().and_then(|value| value.to_str()).unwrap_or("dropped-image").to_string();
    Ok(serde_json::json!({ "name": name, "mimeType": mime, "data": STANDARD.encode(bytes) }))
}


/// List one directory of the session workspace for the Files view.
#[tauri::command]
pub fn workspace_list(path: String) -> Result<serde_json::Value, String> {
    let directory = std::path::Path::new(&path);
    if !directory.is_dir() {
        return Err("That folder is not available.".into());
    }
    let read = std::fs::read_dir(directory).map_err(|_| "The folder could not be read.".to_string())?;
    let mut entries = Vec::new();
    for entry in read.flatten() {
        let metadata = entry.metadata().ok();
        entries.push(serde_json::json!({
            "name": entry.file_name().to_string_lossy(),
            "path": entry.path().to_string_lossy(),
            "isDir": metadata.as_ref().map(|value| value.is_dir()).unwrap_or(false),
            "size": metadata.as_ref().map(|value| value.len()).unwrap_or(0),
        }));
    }
    entries.sort_by(|a, b| {
        let left = a.get("isDir").and_then(|value| value.as_bool()).unwrap_or(false);
        let right = b.get("isDir").and_then(|value| value.as_bool()).unwrap_or(false);
        right.cmp(&left).then(
            a.get("name").and_then(|value| value.as_str()).unwrap_or("").to_lowercase()
                .cmp(&b.get("name").and_then(|value| value.as_str()).unwrap_or("").to_lowercase()),
        )
    });
    Ok(serde_json::json!({ "path": directory.to_string_lossy(), "entries": entries }))
}

/// Copy an artifact to a destination chosen by the user.
#[tauri::command]
pub fn save_copy(from: String, to: String) -> Result<(), String> {
    let source = Path::new(&from);
    if !source.is_file() {
        return Err("That artifact no longer exists.".into());
    }
    std::fs::copy(source, Path::new(&to)).map_err(|_| "The file could not be saved.".to_string())?;
    Ok(())
}

/// Show an artifact in the platform's file browser.
#[tauri::command]
pub fn reveal_path(path: String) -> Result<(), String> {
    let source = Path::new(&path);
    if !source.exists() {
        return Err("That file no longer exists.".into());
    }
    #[cfg(target_os = "windows")]
    let spawned = {
        use std::os::windows::process::CommandExt;
        // explorer.exe parses its own command line, and Rust's normal argument
        // quoting makes /select, fail (the window then opens at the default
        // folder). cmd passes the documented form through untouched.
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let absolute = std::fs::canonicalize(source).unwrap_or_else(|_| source.to_path_buf());
        let display = absolute.to_string_lossy();
        let display = display.strip_prefix(r"\\?\").unwrap_or(&display);
        std::process::Command::new("cmd.exe")
            .raw_arg(format!("/c explorer.exe /select,\"{display}\""))
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
    };
    #[cfg(target_os = "macos")]
    let spawned = std::process::Command::new("open").arg("-R").arg(source).spawn();
    #[cfg(all(unix, not(target_os = "macos")))]
    let spawned = std::process::Command::new("xdg-open")
        .arg(source.parent().unwrap_or(source))
        .spawn();
    spawned.map(|_| ()).map_err(|_| "Could not open the folder.".to_string())
}

#[cfg(test)]
mod workspace_tests {
    use super::*;

    #[test]
    fn lists_folders_before_files() {
        let root = tempfile::tempdir().unwrap();
        std::fs::write(root.path().join("b.txt"), b"x").unwrap();
        std::fs::create_dir(root.path().join("a-dir")).unwrap();
        let value = workspace_list(root.path().to_string_lossy().to_string()).unwrap();
        let entries = value["entries"].as_array().unwrap();
        assert_eq!(entries[0]["name"], "a-dir");
        assert_eq!(entries[1]["name"], "b.txt");
        assert_eq!(entries[0]["isDir"], true);
    }

    #[test]
    fn rejects_a_missing_folder() {
        assert!(workspace_list("C:/definitely/not/here".into()).is_err());
    }

    #[test]
    fn reads_a_workspace_text_file() {
        let root = tempfile::tempdir().unwrap();
        std::fs::write(root.path().join("notes.md"), b"# notes").unwrap();
        let value = workspace_read("notes.md".into(), root.path().to_string_lossy().to_string()).unwrap();
        assert_eq!(value["text"], "# notes");
        assert_eq!(value["binary"], false);
    }

    #[test]
    fn reports_a_binary_file_instead_of_decoding_it() {
        let root = tempfile::tempdir().unwrap();
        std::fs::write(root.path().join("blob.bin"), [0xff, 0xfe, 0x00]).unwrap();
        let value = workspace_read("blob.bin".into(), root.path().to_string_lossy().to_string()).unwrap();
        assert_eq!(value["binary"], true);
        assert_eq!(value["text"], "");
    }

    #[test]
    fn a_preview_cannot_escape_the_workspace() {
        let root = tempfile::tempdir().unwrap();
        let workspace = root.path().join("work");
        std::fs::create_dir(&workspace).unwrap();
        std::fs::write(root.path().join("outside.txt"), b"secret").unwrap();
        let refused = workspace_read("../outside.txt".into(), workspace.to_string_lossy().to_string());
        assert!(refused.is_err());
        let absolute = workspace_read(root.path().join("outside.txt").to_string_lossy().to_string(), workspace.to_string_lossy().to_string());
        assert!(absolute.is_err());
    }

    #[test]
    fn an_oversized_preview_is_reported_not_returned() {
        let root = tempfile::tempdir().unwrap();
        std::fs::write(root.path().join("big.txt"), vec![b'a'; (MAX_PREVIEW_BYTES as usize) + 8]).unwrap();
        let value = workspace_read("big.txt".into(), root.path().to_string_lossy().to_string()).unwrap();
        assert_eq!(value["truncated"], true);
        assert_eq!(value["text"], "");
    }
}
