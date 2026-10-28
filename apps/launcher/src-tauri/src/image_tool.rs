use std::path::{Path, PathBuf};

/// The desktop's own pi extension, installed into the agent's extension folder.
const MANIFEST: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../../packaging/launcher/extensions/jouzu-image/package.json"
));
const EXTENSION: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../../packaging/launcher/extensions/jouzu-image/index.js"
));

pub const MODELS: [(&str, &[&str]); 3] = [
    ("gemini-3.1-flash-image", &["1K", "2K", "4K"]),
    ("gemini-3.1-flash-lite-image", &["1K"]),
    ("gemini-3-pro-image", &["1K", "2K", "4K"]),
];
const DEFAULT_MODEL: &str = "gemini-3.1-flash-lite-image";
const DEFAULT_SIZE: &str = "1K";

fn agent_dir(managed: &Path) -> PathBuf {
    managed.join("data").join("agent")
}

/// Write the extension in place. Idempotent: a newer desktop replaces the files.
pub fn ensure(managed: &Path) -> Result<(), String> {
    let directory = agent_dir(managed).join("extensions").join("jouzu-image");
    std::fs::create_dir_all(&directory).map_err(|error| format!("Could not create the image extension: {error}"))?;
    std::fs::write(directory.join("package.json"), MANIFEST).map_err(|error| error.to_string())?;
    std::fs::write(directory.join("index.js"), EXTENSION).map_err(|error| error.to_string())?;
    Ok(())
}

fn settings_path(managed: &Path) -> PathBuf {
    agent_dir(managed).join("image-generation.json")
}

/// The Control Center choice, also read by the extension at call time.
#[tauri::command]
pub fn image_settings_read() -> Result<serde_json::Value, String> {
    let managed = crate::runtime::managed_root()?;
    let path = settings_path(&managed);
    let value: serde_json::Value = std::fs::read_to_string(&path)
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_else(|| serde_json::json!({ "model": DEFAULT_MODEL, "size": DEFAULT_SIZE }));
    Ok(normalize(value))
}

#[tauri::command]
pub fn image_settings_save(model: String, size: String) -> Result<serde_json::Value, String> {
    let sizes = MODELS
        .iter()
        .find(|(id, _)| *id == model)
        .map(|(_, sizes)| *sizes)
        .ok_or_else(|| "Unknown image model.".to_string())?;
    if !sizes.contains(&size.as_str()) {
        return Err("That image size is not available for the model.".into());
    }
    let managed = crate::runtime::managed_root()?;
    let directory = agent_dir(&managed);
    std::fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    let value = serde_json::json!({ "model": model, "size": size });
    std::fs::write(settings_path(&managed), format!("{}\n", serde_json::to_string_pretty(&value).unwrap()))
        .map_err(|error| error.to_string())?;
    Ok(value)
}

fn normalize(value: serde_json::Value) -> serde_json::Value {
    let model = value
        .get("model")
        .and_then(|model| model.as_str())
        .filter(|model| MODELS.iter().any(|(id, _)| *id == *model))
        .unwrap_or(DEFAULT_MODEL);
    let sizes = MODELS
        .iter()
        .find(|(id, _)| *id == model)
        .map(|(_, sizes)| *sizes)
        .unwrap_or(&[DEFAULT_SIZE]);
    let size = value
        .get("size")
        .and_then(|size| size.as_str())
        .filter(|size| sizes.contains(size))
        .unwrap_or(DEFAULT_SIZE);
    serde_json::json!({ "model": model, "size": size })
}

/// Called after a runtime install and on app start, so existing installs get it too.
#[tauri::command]
pub fn image_tool_ensure() -> Result<(), String> {
    ensure(&crate::runtime::managed_root()?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_extension_lands_where_pi_looks_for_it() {
        let managed = tempfile::tempdir().unwrap();
        ensure(managed.path()).unwrap();
        let directory = managed.path().join("data/agent/extensions/jouzu-image");
        assert!(directory.join("package.json").is_file());
        assert!(directory.join("index.js").is_file());
        let manifest = std::fs::read_to_string(directory.join("package.json")).unwrap();
        assert!(manifest.contains("pi"));
    }

    #[test]
    fn settings_are_normalized_to_a_known_model_and_size() {
        let value = normalize(serde_json::json!({ "model": "gemini-3-pro-image", "size": "1K" }));
        assert_eq!(value["model"], "gemini-3-pro-image");
        let fallback = normalize(serde_json::json!({ "model": "nope", "size": "9K" }));
        assert_eq!(fallback["model"], DEFAULT_MODEL);
        assert_eq!(fallback["size"], DEFAULT_SIZE);
    }
}
