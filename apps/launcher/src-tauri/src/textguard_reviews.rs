use serde_json::Value;
use std::fs;
use std::path::PathBuf;
use tauri::Manager;

fn path(app: &tauri::AppHandle, session_id: &str) -> Result<PathBuf, String> {
    if session_id.is_empty()
        || session_id.len() > 128
        || !session_id
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || character == '-' || character == '_')
    {
        return Err("Invalid TextGuard session id.".into());
    }
    let root = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Could not resolve app data: {error}"))?
        .join("textguard-reviews");
    fs::create_dir_all(&root).map_err(|error| format!("Could not prepare TextGuard storage: {error}"))?;
    Ok(root.join(format!("{session_id}.json")))
}

#[tauri::command]
pub fn textguard_reviews_read(
    app: tauri::AppHandle,
    session_id: String,
) -> Result<Option<Value>, String> {
    let file = path(&app, &session_id)?;
    let text = match fs::read_to_string(&file) {
        Ok(text) => text,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(format!("Could not read TextGuard review: {error}")),
    };
    serde_json::from_str(&text)
        .map(Some)
        .map_err(|error| format!("TextGuard review is unreadable: {error}"))
}

#[tauri::command]
pub fn textguard_reviews_write(
    app: tauri::AppHandle,
    session_id: String,
    review: Value,
) -> Result<(), String> {
    let file = path(&app, &session_id)?;
    let temporary = file.with_extension("json.tmp");
    let body = serde_json::to_vec_pretty(&review)
        .map_err(|error| format!("Could not encode TextGuard review: {error}"))?;
    fs::write(&temporary, body).map_err(|error| format!("Could not write TextGuard review: {error}"))?;
    fs::rename(&temporary, &file).map_err(|error| format!("Could not commit TextGuard review: {error}"))
}

#[tauri::command]
pub fn textguard_reviews_clear(app: tauri::AppHandle, session_id: String) -> Result<(), String> {
    let file = path(&app, &session_id)?;
    match fs::remove_file(file) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("Could not clear TextGuard review: {error}")),
    }
}
