use base64::{engine::general_purpose::STANDARD, Engine};
use std::path::{Component, Path, PathBuf};

/// Artifact records live beside the data, one JSON sidecar per file (see 0072).
fn root() -> Result<PathBuf, String> {
    Ok(crate::runtime::effective_home()?.join("artifacts"))
}

fn within(base: &Path, candidate: &Path) -> bool {
    candidate.components().count() >= base.components().count() && candidate.starts_with(base)
}

fn record_paths(sidecar: &Path) -> Option<(serde_json::Value, PathBuf)> {
    let text = std::fs::read_to_string(sidecar).ok()?;
    let value: serde_json::Value = serde_json::from_str(&text).ok()?;
    let relative = value.get("path")?.as_str()?;
    let relative_path = Path::new(relative);
    if relative_path.is_absolute() || relative_path.components().any(|component| matches!(component, Component::ParentDir | Component::RootDir | Component::Prefix(_))) {
        return None;
    }
    let base = sidecar.parent()?.parent()?;
    let file = base.join(relative_path);
    if !within(base, &file) {
        return None;
    }
    Some((value, file))
}

fn collect(kind: &Path, out: &mut Vec<serde_json::Value>) {
    let Ok(entries) = std::fs::read_dir(kind) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|value| value.to_str()) != Some("json") {
            continue;
        }
        if let Some((mut value, file)) = record_paths(&path) {
            value["absolutePath"] = serde_json::Value::String(file.to_string_lossy().to_string());
            value["exists"] = serde_json::Value::Bool(file.is_file());
            out.push(value);
        }
    }
}

fn session_of(value: &serde_json::Value) -> Option<&str> {
    value.get("source")?.get("sessionId")?.as_str()
}

fn retain_session(records: &mut Vec<serde_json::Value>, session: &str) {
    records.retain(|record| session_of(record) == Some(session));
}

fn count_by_session(records: &[serde_json::Value]) -> std::collections::BTreeMap<String, u64> {
    let mut counts = std::collections::BTreeMap::new();
    for record in records {
        if let Some(session) = session_of(record) {
            *counts.entry(session.to_string()).or_insert(0) += 1;
        }
    }
    counts
}

fn every_artifact(root: &Path) -> Vec<serde_json::Value> {
    let mut artifacts = Vec::new();
    let Ok(entries) = std::fs::read_dir(root) else { return artifacts };
    let mut kinds: Vec<PathBuf> = entries.flatten().map(|entry| entry.path()).filter(|path| path.is_dir()).collect();
    kinds.sort();
    for directory in kinds {
        collect(&directory, &mut artifacts);
    }
    artifacts
}

#[tauri::command]
pub fn artifact_list(kind: Option<String>, session_id: Option<String>) -> Result<serde_json::Value, String> {
    let root = root()?;
    let mut artifacts = Vec::new();
    match kind.filter(|value| !value.trim().is_empty()) {
        Some(name) => collect(&root.join(name), &mut artifacts),
        None => {
            artifacts = every_artifact(&root);
        }
    }
    if let Some(session) = session_id.filter(|value| !value.trim().is_empty()) {
        retain_session(&mut artifacts, &session);
    }
    artifacts.sort_by(|a, b| b.get("createdAt").and_then(|value| value.as_str()).unwrap_or("").cmp(a.get("createdAt").and_then(|value| value.as_str()).unwrap_or("")));
    artifacts.truncate(200);
    Ok(serde_json::json!({ "artifacts": artifacts }))
}

/// One count per session, for sidebar badges; no file bodies are read.
#[tauri::command]
pub fn artifact_counts() -> Result<serde_json::Value, String> {
    let records = every_artifact(&root()?);
    Ok(serde_json::json!({ "counts": count_by_session(&records) }))
}

#[tauri::command]
pub fn artifact_read(id: String) -> Result<serde_json::Value, String> {
    if !id.chars().all(|character| character.is_ascii_hexdigit()) || id.len() < 16 {
        return Err("That artifact id is not valid.".into());
    }
    let root = root()?;
    let Ok(entries) = std::fs::read_dir(&root) else { return Err("No artifacts yet.".into()) };
    for directory in entries.flatten().map(|entry| entry.path()).filter(|path| path.is_dir()) {
        let sidecar = directory.join(format!("{id}.json"));
        if !sidecar.is_file() {
            continue;
        }
        let Some((value, file)) = record_paths(&sidecar) else { continue };
        let bytes = std::fs::read(&file).map_err(|_| "That artifact file is missing.".to_string())?;
        return Ok(serde_json::json!({
            "record": value,
            "mimeType": value.get("mimeType").and_then(|mime| mime.as_str()).unwrap_or("application/octet-stream"),
            "data": STANDARD.encode(bytes),
        }));
    }
    Err("That artifact was not found.".into())
}

#[tauri::command]
pub fn artifact_delete(id: String) -> Result<(), String> {
    if !id.chars().all(|character| character.is_ascii_hexdigit()) || id.len() < 16 {
        return Err("That artifact id is not valid.".into());
    }
    let root = root()?;
    let Ok(entries) = std::fs::read_dir(&root) else { return Err("No artifacts yet.".into()) };
    for directory in entries.flatten().map(|entry| entry.path()).filter(|path| path.is_dir()) {
        let sidecar = directory.join(format!("{id}.json"));
        if !sidecar.is_file() {
            continue;
        }
        if let Some((_, file)) = record_paths(&sidecar) {
            let _ = std::fs::remove_file(&file);
        }
        std::fs::remove_file(&sidecar).map_err(|_| "The artifact record could not be removed.".to_string())?;
        return Ok(());
    }
    Err("That artifact was not found.".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn seed(home: &Path) -> (PathBuf, PathBuf) {
        let directory = home.join("artifacts").join("images");
        std::fs::create_dir_all(&directory).unwrap();
        let file = directory.join("a".repeat(64) + ".png");
        std::fs::write(&file, b"png-bytes").unwrap();
        let record = serde_json::json!({
            "schema": 1,
            "id": "a".repeat(64),
            "kind": "images",
            "mimeType": "image/png",
            "path": format!("images/{}.png", "a".repeat(64)),
            "bytes": 9,
            "createdAt": "2026-10-29T00:00:00.000Z",
            "prompt": "a cat",
        });
        let sidecar = directory.join("a".repeat(64) + ".json");
        std::fs::write(&sidecar, record.to_string()).unwrap();
        (file, sidecar)
    }

    #[test]
    fn lists_records_with_absolute_paths() {
        let home = tempfile::tempdir().unwrap();
        seed(home.path());
        let root = home.path();
        let mut artifacts = Vec::new();
        collect(&root.join("artifacts/images"), &mut artifacts);
        assert_eq!(artifacts.len(), 1);
        assert_eq!(artifacts[0]["prompt"], "a cat");
        assert!(artifacts[0]["absolutePath"].as_str().unwrap().ends_with(".png"));
    }


    #[test]
    fn filters_and_counts_by_session() {
        let home = tempfile::tempdir().unwrap();
        let directory = home.path().join("artifacts/images");
        std::fs::create_dir_all(&directory).unwrap();
        for (index, session) in ["s1", "s1", "s2"].iter().enumerate() {
            let id = format!("{:064x}", index);
            let record = serde_json::json!({
                "id": id,
                "kind": "images",
                "path": format!("images/{id}.png"),
                "createdAt": format!("2026-10-29T00:00:0{index}Z"),
                "source": { "sessionId": session },
            });
            std::fs::write(directory.join(format!("{id}.json")), record.to_string()).unwrap();
            std::fs::write(directory.join(format!("{id}.png")), b"x").unwrap();
        }
        let mut records = Vec::new();
        collect(&directory, &mut records);
        assert_eq!(records.len(), 3);
        let mut filtered = records.clone();
        retain_session(&mut filtered, "s1");
        assert_eq!(filtered.len(), 2);
        let counts = count_by_session(&records);
        assert_eq!(counts.get("s1"), Some(&2));
        assert_eq!(counts.get("s2"), Some(&1));
    }

    #[test]
    fn a_record_cannot_escape_the_artifacts_root() {
        let home = tempfile::tempdir().unwrap();
        let directory = home.path().join("artifacts/images");
        std::fs::create_dir_all(&directory).unwrap();
        std::fs::write(directory.join("b".repeat(64) + ".json"), serde_json::json!({ "path": "../../secret.txt" }).to_string()).unwrap();
        let mut artifacts = Vec::new();
        collect(&directory, &mut artifacts);
        assert!(artifacts.is_empty());
    }
}
