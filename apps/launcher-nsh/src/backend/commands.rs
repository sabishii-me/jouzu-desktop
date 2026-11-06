//! Launcher commands ported from the Tauri shell's main.rs. The bodies keep the
//! baseline behavior; the dispatch in bridge.rs names them the same way the
//! frontend's invoke() always has.

use crate::{
    active_app, bug_report, command_path, git_environment, logs, runtime,
    runtime_install, terminal,
};

use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Serialize, Deserialize)]
pub struct Environment {
    kind: String,
}
#[derive(Serialize, Deserialize)]
pub struct Workspace {
    id: String,
    path: String,
    environment: Environment,
}
#[derive(Serialize, Deserialize)]
pub struct LauncherState {
    platform: String,
    ready: bool,
    bash: bool,
    bundled_git: bool,
    recent: Vec<Workspace>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LegacyPreference {
    schema_version: u32,
    remember: bool,
    folder: String,
}

pub fn platform() -> &'static str {
    if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "macos") {
        "macos"
    } else {
        "linux"
    }
}

pub fn legacy_workspace(content: &str) -> Result<Option<Workspace>, String> {
    let preference: LegacyPreference = serde_json::from_str(content.trim_start_matches('\u{feff}'))
        .map_err(|error| format!("Cannot read remembered folder: {error}"))?;
    if preference.schema_version != 1 {
        return Err("Unsupported folder preference version".into());
    }
    if !preference.remember || preference.folder.is_empty() {
        return Ok(None);
    }
    Ok(Some(Workspace {
        id: format!("windows:{}", preference.folder),
        path: preference.folder,
        environment: Environment {
            kind: "windows".into(),
        },
    }))
}

pub fn read_legacy(path: &Path) -> Result<Vec<Workspace>, String> {
    let content = match std::fs::read_to_string(path) {
        Ok(content) => content,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(vec![]),
        Err(error) => return Err(format!("Cannot read folder preferences: {error}")),
    };
    Ok(legacy_workspace(&content)?.into_iter().collect())
}

/// What the System section shows about the previous run and where support material lives.
pub fn diagnostics() -> Result<serde_json::Value, String> {
    let managed = runtime::managed_root()?;
    Ok(serde_json::json!({
        "logs": logs::directory(&managed).to_string_lossy(),
        "crashes": logs::crash_records(&managed),
    }))
}

pub fn crash_dismiss(path: String) -> Result<(), String> {
    let managed = runtime::managed_root()?;
    logs::dismiss_crash(&managed, &path)
}

/// Build the report draft with the payload's own reporter, and answer what the Launcher knows about this
/// installation when that reporter is not there.
pub fn bug_report(
    description: String,
    expected: String,
    actual: String,
    reproduction: String,
) -> Result<serde_json::Value, String> {
    Ok(
        bug_report::draft(&description, &expected, &actual, &reproduction).unwrap_or_else(|_| {
            serde_json::json!({
                "available": false,
                "title": "",
                "body": "",
                "issueUrl": bug_report::ISSUE_NEW_URL,
            })
        }),
    )
}

/// Open a terminal in a folder with the environment this installation manages, without starting Jouzu.
/// The session itself is built by the script the installer carries, so the window, a terminal entry and
/// this button describe one environment in one place.
pub fn terminal_open(path: Option<String>) -> Result<(), String> {
    // A terminal opens in the folder the launcher already has; without one it opens in the user's home
    // rather than asking, because a terminal does not need a folder to be useful.
    let folder = path
        .filter(|value| Path::new(value).is_dir())
        .map(std::path::PathBuf::from)
        .or_else(|| std::env::var_os("USERPROFILE").map(std::path::PathBuf::from))
        .ok_or("Cannot find a folder to open the terminal in.")?;
    let root = runtime::application_root()?;
    let managed = runtime::managed_root()?;
    let slot = active_app::resolve_app(&root, &managed)?;
    let bash = git_environment::find(&root)?;
    let host = terminal::host(&root)
        .ok_or("Windows Terminal is unavailable. Install it from the launcher.")?;
    let status = std::process::Command::new(crate::runtime_install::node_executable(&root))
        .arg(root.join("runtime/launcher-update/open-terminal.mjs"))
        .arg(&slot)
        .arg(&managed)
        .arg(&host)
        .arg(&bash)
        .arg(runtime::effective_home()?)
        .arg(&folder)
        .status()
        .map_err(|error| error.to_string())?;
    if !status.success() {
        return Err("The terminal could not be opened.".into());
    }
    Ok(())
}

pub fn command_entry_report() -> Result<serde_json::Value, String> {
    command_path::report(&runtime::application_root()?, &runtime::managed_root()?)
}

pub fn command_entry_use() -> Result<serde_json::Value, String> {
    command_path::use_jouzu(&runtime::application_root()?, &runtime::managed_root()?)
}

pub fn command_entry_repair() -> Result<serde_json::Value, String> {
    command_path::repair(&runtime::application_root()?, &runtime::managed_root()?)
}

pub fn command_entry_remove() -> Result<serde_json::Value, String> {
    command_path::remove(&runtime::application_root()?, &runtime::managed_root()?)
}

/// The transcript owns the URL policy: only ordinary http(s) URLs without
/// embedded credentials leave the app, for any host.
pub async fn open_external_url(url: String) -> Result<(), String> {
    let parsed = external_http_url(&url)?;
    if nsh_core::prelude::open_url(parsed.to_string()).await {
        Ok(())
    } else {
        Err("Could not open link.".to_string())
    }
}

pub fn external_http_url(value: &str) -> Result<url::Url, String> {
    let parsed = url::Url::parse(value).map_err(|_| "This link cannot be opened externally.".to_string())?;
    if !matches!(parsed.scheme(), "http" | "https")
        || parsed.host_str().is_none()
        || !parsed.username().is_empty()
        || parsed.password().is_some()
    {
        return Err("This link cannot be opened externally.".into());
    }
    Ok(parsed)
}

/// The log folder is where a report's evidence lives; the folder opens, and the interface names no path.
pub async fn open_logs() -> Result<(), String> {
    let directory = logs::directory(&runtime::managed_root()?);
    std::fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    nsh_core::prelude::open_path(directory)
        .await
        .map_err(|error| error.to_string())
}

/// The interface watches the Launcher's own update through a plugin, which no command sees, and a
/// silent check has to leave a trace somewhere, so both hand one line here.
pub fn log_event(message: String) -> Result<(), String> {
    logs::note(&runtime::managed_root()?, &message);
    Ok(())
}

pub fn default_workspace_path() -> Result<std::path::PathBuf, String> {
    let home = std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .ok_or("The user profile is unavailable")?;
    let base = if cfg!(target_os = "windows") {
        std::path::PathBuf::from(home).join("Documents")
    } else {
        std::path::PathBuf::from(home)
    };
    let path = base.join("Jouzu").join("default-workspace");
    std::fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    Ok(path)
}

pub fn launcher_state() -> Result<LauncherState, String> {
    let history = runtime::managed_root()?.join("recent.json");
    let recent = if cfg!(target_os = "windows") {
        match std::env::var_os("LOCALAPPDATA") {
            Some(root) => {
                read_legacy(&Path::new(&root).join("JouzuDesktop").join("launcher.json"))?
            }
            None => vec![],
        }
    } else {
        vec![]
    };
    let mut recent: Vec<Workspace> = if history.exists() {
        serde_json::from_slice(&std::fs::read(&history).map_err(|e| e.to_string())?)
            .map_err(|e| format!("Cannot read history: {e}"))?
    } else {
        recent
    };
    recent.retain(|workspace| Path::new(&workspace.path).is_dir());
    if recent.is_empty() {
        if let Ok(path) = default_workspace_path() {
            recent.push(Workspace {
                id: format!("{}:{}", platform(), path.display()),
                path: path.display().to_string(),
                environment: Environment { kind: platform().into() },
            });
            if let Ok(data) = runtime::managed_root() {
                let _ = std::fs::create_dir_all(&data);
                if let Ok(mut file) = tempfile::NamedTempFile::new_in(&data) {
                    if serde_json::to_writer(&mut file, &recent).is_ok() {
                        let _ = file.persist(data.join("recent.json"));
                    }
                }
            }
        }
    }
    Ok(LauncherState {
        platform: platform().into(),
        ready: runtime::application_root().is_ok(),
        bash: runtime::find_bash().is_some(),
        bundled_git: runtime::application_root()
            .map(|root| root.join("runtime/git/PortableGit.exe").is_file())
            .unwrap_or(false),
        recent,
    })
}

pub fn launch_jouzu(path: String) -> Result<(), String> {
    if let Err(error) = runtime::launch(&path) {
        if let Ok(managed) = runtime::managed_root() {
            logs::append(&managed, "launcher.log", &format!("launch failed folder={path} error={error}"));
        }
        return Err(error);
    }
    if let Ok(managed) = runtime::managed_root() {
        logs::append(&managed, "launcher.log", &format!("launch folder={path}"));
    }
    let mut state = launcher_state()?;
    if !state.recent.iter().any(|item| item.path == path) {
        state.recent.push(Workspace {
            id: format!("{}:{}", platform(), path),
            path,
            environment: Environment {
                kind: platform().into(),
            },
        });
    }

    let data = runtime::managed_root()?;
    std::fs::create_dir_all(&data).map_err(|e| e.to_string())?;
    let mut file = tempfile::NamedTempFile::new_in(&data).map_err(|e| e.to_string())?;
    serde_json::to_writer(&mut file, &state.recent).map_err(|e| e.to_string())?;
    file.persist(data.join("recent.json"))
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn add_workspaces(paths: Vec<String>) -> Result<(), String> {
    if paths.len() > 1000 {
        return Err("Too many folders in one operation".into());
    }
    let mut state = launcher_state()?;
    for path in &paths {
        if !Path::new(path).is_dir() {
            return Err("Only existing folders can be added".into());
        }
    }
    for path in paths {
        let canonical = std::fs::canonicalize(&path).map_err(|e| e.to_string())?;
        if state.recent.iter().any(|item| {
            std::fs::canonicalize(&item.path)
                .map(|p| p == canonical)
                .unwrap_or(item.path == path)
        }) {
            continue;
        }
        state.recent.push(Workspace {
            id: format!("{}:{}", platform(), path),
            path,
            environment: Environment {
                kind: platform().into(),
            },
        });
    }
    let data = runtime::managed_root()?;
    std::fs::create_dir_all(&data).map_err(|e| e.to_string())?;
    let mut file = tempfile::NamedTempFile::new_in(&data).map_err(|e| e.to_string())?;
    serde_json::to_writer(&mut file, &state.recent).map_err(|e| e.to_string())?;
    file.persist(data.join("recent.json"))
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn forget_workspace(id: String) -> Result<(), String> {
    let mut state = launcher_state()?;
    state.recent.retain(|item| item.id != id);
    let data = runtime::managed_root()?;
    std::fs::create_dir_all(&data).map_err(|e| e.to_string())?;
    let mut file = tempfile::NamedTempFile::new_in(&data).map_err(|e| e.to_string())?;
    serde_json::to_writer(&mut file, &state.recent).map_err(|e| e.to_string())?;
    file.persist(data.join("recent.json"))
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn hidden_node_version(node: &std::path::Path) -> Option<String> {
    let mut command = std::process::Command::new(node);
    command.arg("--version");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    command.output().ok().map(|output| String::from_utf8_lossy(&output.stdout).trim().to_string())
}

pub fn runtime_report() -> Result<serde_json::Value, String> {
    let root = runtime::application_root()?;
    let managed = runtime::managed_root()?;
    let app_path = active_app::resolve_app(&root, &managed)?;
    let metadata: serde_json::Value = serde_json::from_slice(
        &std::fs::read(app_path.join("node_modules/jouzu/package.json"))
            .map_err(|_| "Runtime metadata is unavailable")?,
    )
    .map_err(|_| "Runtime metadata is invalid")?;
    let version = metadata
        .get("version")
        .and_then(|value| value.as_str())
        .ok_or("Runtime version is missing")?;
    Ok(serde_json::json!({
        "version": version,
        "root": root.to_string_lossy(),
        "app": app_path.to_string_lossy(),
        "node": crate::runtime_install::node_executable(&root).is_file(),
        "nodeVersion": hidden_node_version(&crate::runtime_install::node_executable(&root)),
        "nodeCurrent": crate::runtime_install::node_version_ok(&root),
        "git": root.join("runtime/git").exists(),
        "terminal": root.join("runtime/terminal").exists(),
    }))
}

pub async fn runtime_install() -> Result<serde_json::Value, String> {
    let managed = runtime::managed_root()?;
    let version = nsh_core::prelude::blocking(move || {
        let emit = |value: serde_json::Value| { crate::events::publish("runtime-install-progress", value); };
        runtime_install::install(&managed, &emit)
    })
    .await
    .map_err(|_| "Runtime installation failed".to_string())??;
    Ok(serde_json::json!({ "version": version }))
}

pub fn mcp_config() -> Result<serde_json::Value, String> {
    let path = runtime::effective_home()?.join("agent/mcp.json");
    let text = std::fs::read_to_string(&path).unwrap_or_default();
    let value = serde_json::from_str::<serde_json::Value>(&text)
        .unwrap_or_else(|_| serde_json::json!({ "mcpServers": {} }));
    let servers = value
        .get("mcpServers")
        .and_then(serde_json::Value::as_object)
        .map(|entries| {
            entries
                .iter()
                .map(|(name, config)| {
                    let url = config.get("url").and_then(serde_json::Value::as_str);
                    let command = config.get("command").and_then(serde_json::Value::as_str);
                    let target = url.or(command).unwrap_or("Unknown target");
                    serde_json::json!({
                        "name": name,
                        "transport": if url.is_some() { "HTTP" } else if command.is_some() { "Local" } else { "Unknown" },
                        "target": target,
                        "description": config.get("description").and_then(serde_json::Value::as_str),
                        "exposure": config.get("exposure").and_then(serde_json::Value::as_str).unwrap_or("deferred"),
                    })
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    Ok(serde_json::json!({
        "path": path.to_string_lossy(),
        "exists": path.is_file(),
        "servers": servers,
    }))
}

pub fn component_versions() -> Result<serde_json::Value, String> {
    // The updater flags describe the shell. A missing, broken or outdated runtime must not
    // disable them; that is the only way a broken install can still update itself.
    // The Tauri shell updater is not ported (PORTING.md); the runtime updater below is.
    let launcher_updater = false;
    let root = runtime::application_root().ok();
    let value = root
        .as_ref()
        .and_then(|root| {
            let managed = runtime::managed_root().ok()?;
            active_app::resolve_app(root, &managed).ok()
        })
        .and_then(|path| std::fs::read(path.join("node_modules/jouzu/package.json")).ok())
        .and_then(|bytes| serde_json::from_slice::<serde_json::Value>(&bytes).ok())
        .unwrap_or(serde_json::Value::Null);
    let jouzu_updater = root.as_ref().is_some_and(|root| {
        root.join("jouzu-update.json").is_file()
            && root.join("runtime/launcher-update/update-service.mjs").is_file()
    });
    Ok(serde_json::json!({
        "jouzuUpdaterConfigured": jouzu_updater,
        "jouzu": value.get("version").and_then(|v| v.as_str()),
        "development": cfg!(debug_assertions),
        "launcherUpdaterConfigured": launcher_updater,
    }))
}

pub fn console_repair_needed() -> Result<bool, String> {
    let root = runtime::application_root()?;
    // The console is drawn by the terminal Jouzu ships, so a machine that does not have that copy yet
    // installs it before Jouzu starts, whatever terminal it already has.
    Ok(!terminal::bundled_copy(&root))
}

pub fn terminal() -> Result<serde_json::Value, String> {
    terminal::report(&runtime::application_root()?)
}

pub async fn terminal_install() -> Result<serde_json::Value, String> {
    let root = runtime::application_root()?;
    let outcome = nsh_core::prelude::blocking(move || terminal::install(&root)).await;
    if let Ok(managed) = runtime::managed_root() {
        let result = match &outcome {
            Ok(Ok(path)) => format!("installed {}", path.display()),
            Ok(Err(error)) => format!("failed {error}"),
            Err(_) => "failed task".to_string(),
        };
        logs::append(&managed, "launcher.log", &format!("windows terminal install {result}"));
    }
    outcome.map_err(|_| "Windows Terminal installation failed".to_string())??;
    terminal::report(&runtime::application_root()?)
}

pub fn git_bash() -> Result<serde_json::Value, String> {
    git_environment::report(&runtime::application_root()?)
}

pub async fn git_bash_install() -> Result<serde_json::Value, String> {
    let root = runtime::application_root()?;
    nsh_core::prelude::blocking(move || git_environment::install(&root))
        .await
        .map_err(|_| "Git Bash installation failed".to_string())??;
    git_environment::report(&runtime::application_root()?)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn imports_remembered_folder() {
        let w = legacy_workspace(r#"{"schemaVersion":1,"remember":true,"folder":"project"}"#)
            .unwrap()
            .unwrap();
        assert_eq!(w.path, "project");
    }
    #[test]
    fn respects_forgetting() {
        assert!(
            legacy_workspace(r#"{"schemaVersion":1,"remember":false,"folder":"old"}"#)
                .unwrap()
                .is_none()
        );
    }
    #[test]
    fn rejects_invalid_preferences() {
        assert!(legacy_workspace("not json").is_err());
        assert!(legacy_workspace(r#"{"schemaVersion":2,"remember":true,"folder":"x"}"#).is_err());
    }
    #[test]
    fn external_links_allow_any_http_host() {
        assert!(external_http_url("http://localhost:8100").is_ok());
        assert!(external_http_url("https://example.com/a?b=1").is_ok());
    }
    #[test]
    fn external_links_reject_other_schemes_and_credentials() {
        assert!(external_http_url("file:///C:/Windows/notepad.exe").is_err());
        assert!(external_http_url("javascript:alert(1)").is_err());
        assert!(external_http_url("https://user:pass@example.com/").is_err());
        assert!(external_http_url("http://").is_err());
    }
}

