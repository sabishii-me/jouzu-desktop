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
const SHISA: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../../packaging/launcher/extensions/jouzu-image/providers/shisa.mjs"
));
const ARTIFACTS: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../../packaging/launcher/extensions/jouzu-image/artifacts.mjs"
));

/// The provider's size settings; which model offers which size is the service's
/// answer, not a desktop table.
const SIZES: [&str; 3] = ["1K", "2K", "4K"];
const DEFAULT_MODEL: &str = "gemini-3.1-flash-lite-image";
const DEFAULT_SIZE: &str = "1K";
const BASE: &str = "https://api.shisa.ai/image";

fn valid_model(model: &str) -> bool {
    !model.is_empty() && model.len() <= 128 && model.chars().all(|character| character.is_ascii_alphanumeric() || matches!(character, '.' | '-' | '_' | '/'))
}

fn agent_dir(managed: &Path) -> PathBuf {
    managed.join("data").join("agent")
}

/// Write the extension in place. Idempotent: a newer desktop replaces the files.
pub fn ensure(managed: &Path) -> Result<(), String> {
    let directory = agent_dir(managed).join("extensions").join("jouzu-image");
    std::fs::create_dir_all(directory.join("providers")).map_err(|error| format!("Could not create the image extension: {error}"))?;
    std::fs::write(directory.join("package.json"), MANIFEST).map_err(|error| error.to_string())?;
    std::fs::write(directory.join("index.js"), EXTENSION).map_err(|error| error.to_string())?;
    std::fs::write(directory.join("providers").join("shisa.mjs"), SHISA).map_err(|error| error.to_string())?;
    std::fs::write(directory.join("artifacts.mjs"), ARTIFACTS).map_err(|error| error.to_string())?;
    Ok(())
}

fn settings_path(managed: &Path) -> PathBuf {
    agent_dir(managed).join("image-generation.json")
}

pub fn read_settings(managed: &Path) -> Result<serde_json::Value, String> {
    let path = settings_path(managed);
    let value: serde_json::Value = std::fs::read_to_string(&path)
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_else(|| serde_json::json!({ "model": DEFAULT_MODEL, "size": DEFAULT_SIZE }));
    Ok(normalize(value))
}

pub fn save_settings(managed: &Path, model: &str, size: &str) -> Result<serde_json::Value, String> {
    if !valid_model(model) {
        return Err("Choose an image model.".into());
    }
    if !SIZES.contains(&size) {
        return Err("That image size is not available.".into());
    }
    let directory = agent_dir(managed);
    std::fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    let value = serde_json::json!({ "model": model, "size": size });
    std::fs::write(settings_path(managed), format!("{}\n", serde_json::to_string_pretty(&value).unwrap()))
        .map_err(|error| error.to_string())?;
    Ok(value)
}

/// The Control Center choice, also read by the extension at call time.
#[tauri::command]
pub fn image_settings_read() -> Result<serde_json::Value, String> {
    read_settings(&crate::runtime::managed_root()?)
}

#[tauri::command]
pub fn image_settings_save(model: String, size: String) -> Result<serde_json::Value, String> {
    save_settings(&crate::runtime::managed_root()?, &model, &size)
}

fn normalize(value: serde_json::Value) -> serde_json::Value {
    let model = value
        .get("model")
        .and_then(|model| model.as_str())
        .filter(|model| valid_model(model))
        .unwrap_or(DEFAULT_MODEL);
    let size = value
        .get("size")
        .and_then(|size| size.as_str())
        .filter(|size| SIZES.contains(size))
        .unwrap_or(DEFAULT_SIZE);
    serde_json::json!({ "model": model, "size": size })
}

fn token(managed: &Path) -> Result<String, String> {
    if let Ok(entries) = crate::environment::environment_read() {
        if let Some(entry) = entries.into_iter().find(|entry| entry.enabled && entry.name == "SHISA_API_KEY") {
            let value = entry.value.trim().to_string();
            if !value.is_empty() {
                return Ok(value);
            }
        }
    }
    let path = agent_dir(managed).join("auth.json");
    let bytes = std::fs::read(&path).map_err(|_| "Sign in to Shisa.AI first.".to_string())?;
    let value: serde_json::Value = serde_json::from_slice(&bytes).map_err(|_| "The Shisa.AI sign-in record could not be read.".to_string())?;
    value
        .get("shisa")
        .and_then(|shisa| shisa.get("access"))
        .and_then(|access| access.as_str())
        .filter(|access| !access.trim().is_empty())
        .map(str::to_string)
        .ok_or_else(|| "Sign in to Shisa.AI first.".to_string())
}

/// The models the signed-in account can use; the service is the source of truth.
#[tauri::command]
pub fn image_models() -> Result<serde_json::Value, String> {
    let managed = crate::runtime::managed_root()?;
    let bearer = token(&managed)?;
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|_| "Could not read the image models.".to_string())?;
    let response = client
        .get(format!("{BASE}/models"))
        .bearer_auth(&bearer)
        .send()
        .map_err(|_| "Could not reach Shisa.AI for the image models.".to_string())?;
    let status = response.status().as_u16();
    let bytes = response.bytes().map_err(|_| "Could not read the image models.".to_string())?;
    let value: serde_json::Value = serde_json::from_slice(&bytes).unwrap_or(serde_json::Value::Null);
    if !(200..300).contains(&status) {
        return Err(match status {
            401 => "Sign in to Shisa.AI again.".to_string(),
            403 => "This account cannot use image generation.".to_string(),
            _ => format!("Could not read the image models (HTTP {status})."),
        });
    }
    let models: Vec<String> = value
        .get("models")
        .or_else(|| value.get("data"))
        .and_then(|list| list.as_array())
        .map(|list| {
            list.iter()
                .filter_map(|item| item.get("name").or_else(|| item.get("id")).and_then(|id| id.as_str()))
                .map(|id| id.trim_start_matches("models/").to_string())
                .filter(|id| valid_model(id))
                .collect()
        })
        .unwrap_or_default();
    Ok(serde_json::json!({ "models": models }))
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
        assert!(directory.join("providers/shisa.mjs").is_file());
        assert!(directory.join("artifacts.mjs").is_file());
        let manifest = std::fs::read_to_string(directory.join("package.json")).unwrap();
        assert!(manifest.contains("pi"));
    }

    #[test]
    fn settings_round_trip_and_reject_an_empty_model_or_unknown_size() {
        let managed = tempfile::tempdir().unwrap();
        let saved = save_settings(managed.path(), "gemini-3-pro-image", "2K").unwrap();
        assert_eq!(saved["size"], "2K");
        let read = read_settings(managed.path()).unwrap();
        assert_eq!(read["model"], "gemini-3-pro-image");
        assert_eq!(read["size"], "2K");
        assert!(save_settings(managed.path(), "", "1K").is_err());
        assert!(save_settings(managed.path(), "gemini-3-pro-image", "9K").is_err());
    }

    #[test]
    fn settings_are_normalized_without_a_model_table() {
        let value = normalize(serde_json::json!({ "model": "gemini-3-pro-image", "size": "1K" }));
        assert_eq!(value["model"], "gemini-3-pro-image");
        // The service owns the model list; a well-formed id is kept.
        let dynamic = normalize(serde_json::json!({ "model": "future-image-model", "size": "9K" }));
        assert_eq!(dynamic["model"], "future-image-model");
        assert_eq!(dynamic["size"], DEFAULT_SIZE);
        let invalid = normalize(serde_json::json!({ "model": " ", "size": "1K" }));
        assert_eq!(invalid["model"], DEFAULT_MODEL);
    }
}
