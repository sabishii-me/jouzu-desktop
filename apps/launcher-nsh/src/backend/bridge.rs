//! The native bridge the TSX host calls. `Backend.invoke` keeps the baseline
//! Tauri wire contract: a command name, a JSON argument object, and a JSON
//! envelope back (`{ok: true, value}` / `{ok: false, error}`), so structured
//! errors (like image read failures) reach the UI unchanged. Synchronous
//! commands run on blocking threads; dialog and opener commands stay on the
//! engine thread, where NSH's services live.

use crate::{artifacts, attachments, chat, commands, control, environment, events, image_tool, jouzu_update, recovery, sessions};
use nsh_core::prelude::*;
use serde::Serialize;
use serde_json::{json, Value};

/// The launcher backend, called through the host's invoke shim.
#[module]
pub struct Backend;

#[module]
impl Backend {
    /// Runs a launcher command with a JSON argument object; returns a JSON
    /// envelope `{ok, value | error}`. The command names match the baseline
    /// Tauri commands.
    pub async fn invoke(command: String, args_json: String) -> String {
        let args: Value = match serde_json::from_str(&args_json) {
            Ok(value) => value,
            Err(error) => return error_envelope(format!("Invalid arguments: {error}")),
        };
        match dispatch(&command, args).await {
            Ok(envelope) => envelope,
            Err(message) => error_envelope(message),
        }
    }

    /// Shows the system folder picker; the chosen paths, or null when cancelled.
    pub async fn pick_folders() -> Result<Option<Vec<String>>, String> {
        let dialog = nsh_core::file_dialog::OpenDialog::folders().multiple(true);
        pick_paths(dialog).await.map(|picked| {
            picked.map(|paths| paths.into_iter().map(|p| p.to_string_lossy().into_owned()).collect())
        })
    }

    /// Shows the system save dialog suggesting `fileName`; the chosen path, or
    /// null when cancelled. The file is not created.
    pub async fn pick_save_path(file_name: String) -> Result<Option<String>, String> {
        let dialog = nsh_core::file_dialog::SaveDialog::new().file_name(file_name);
        pick_save_path(dialog)
            .await
            .map(|picked| picked.map(|p| p.to_string_lossy().into_owned()))
    }

    /// One-time startup work the Tauri setup closure used to do: legacy data
    /// migration, the panic hook, superseded-executable cleanup and the start
    /// line in the log.
    pub fn init() -> Result<(), String> {
        init_once();
        Ok(())
    }

    /// Stops every chat runtime. Called when the app is about to quit.
    pub fn shutdown() {
        chat::service().shutdown();
    }
}

/// Backend events (`runtime-install-progress`, `control-device`,
/// `jouzu-update-progress`), delivered as JSON batches.
#[module]
pub struct Events;

#[module]
impl Events {
    /// Resolves with a JSON array of `{event, payload}` as soon as at least
    /// one event is published; the host pumps this in a loop.
    pub async fn wait() -> String {
        let batch = events::wait().await;
        serde_json::to_string(&batch).unwrap_or_else(|_| "[]".into())
    }
}

fn init_once() {
    static INIT: std::sync::Once = std::sync::Once::new();
    INIT.call_once(|| {
        if let Ok(managed) = crate::runtime::managed_root() {
            crate::logs::install_panic_hook(managed.clone(), env!("CARGO_PKG_VERSION"));
            crate::logs::append(
                &managed,
                "launcher.log",
                &format!("launcher start version={} (nsh)", env!("CARGO_PKG_VERSION")),
            );
        }
        let _ = crate::migration::migrate_legacy_launcher_data();
        if let Ok(executable) = std::env::current_exe() {
            if let Ok(root) = crate::runtime::install_root_for_executable(&executable) {
                crate::runtime::cleanup_superseded_executables(&root);
            }
        }
    });
}

fn envelope<T: Serialize, E: Serialize>(result: Result<T, E>) -> String {
    match result {
        Ok(value) => json!({ "ok": true, "value": value }).to_string(),
        Err(error) => json!({ "ok": false, "error": error }).to_string(),
    }
}

fn error_envelope(error: String) -> String {
    json!({ "ok": false, "error": error }).to_string()
}

fn arg_str(args: &Value, key: &str) -> Result<String, String> {
    args.get(key)
        .and_then(Value::as_str)
        .map(str::to_owned)
        .ok_or_else(|| format!("Missing argument: {key}"))
}

fn arg_opt_str(args: &Value, key: &str) -> Option<String> {
    args.get(key).and_then(Value::as_str).map(str::to_owned)
}

fn arg_value(args: &Value, key: &str) -> Result<Value, String> {
    args.get(key).cloned().ok_or_else(|| format!("Missing argument: {key}"))
}

fn arg_from<T: serde::de::DeserializeOwned>(args: &Value, key: &str) -> Result<T, String> {
    serde_json::from_value(arg_value(args, key)?).map_err(|error| format!("Invalid argument {key}: {error}"))
}

fn arg_opt_usize(args: &Value, key: &str) -> Option<usize> {
    args.get(key).and_then(Value::as_u64).map(|value| value as usize)
}

/// Runs a synchronous command body on a blocking thread and envelopes its result.
async fn off_thread(
    body: impl FnOnce() -> String + Send + 'static,
) -> Result<String, String> {
    nsh_core::prelude::blocking(body)
        .await
        .map_err(|error| error.to_string())
}

async fn dispatch(command: &str, args: Value) -> Result<String, String> {
    let response = match command {
        // Chat supervisor -----------------------------------------------------
        "chat_start" => {
            let path = arg_str(&args, "path")?;
            let generation = arg_opt_str(&args, "generation");
            let key = arg_opt_str(&args, "key");
            off_thread(move || envelope(chat::chat_start(path, generation, key))).await?
        }
        "chat_send" => {
            let handle = arg_str(&args, "handle")?;
            let request = arg_value(&args, "request")?;
            off_thread(move || envelope(chat::chat_send(handle, request))).await?
        }
        "chat_poll" => {
            let handle = arg_str(&args, "handle")?;
            off_thread(move || envelope(chat::chat_poll(handle))).await?
        }
        "chat_poll_many" => {
            let handles = arg_from(&args, "handles")?;
            off_thread(move || envelope(chat::chat_poll_many(handles))).await?
        }
        "chat_scratch_dir" => off_thread(|| envelope(chat::chat_scratch_dir())).await?,
        "chat_release_generation" => {
            let generation = arg_str(&args, "generation")?;
            off_thread(move || envelope(chat::chat_release_generation(generation))).await?
        }
        "chat_claim" => {
            let handle = arg_str(&args, "handle")?;
            let session_key = arg_str(&args, "sessionKey")?;
            off_thread(move || envelope(chat::chat_claim(handle, session_key))).await?
        }
        "chat_stop" => {
            let handle = arg_str(&args, "handle")?;
            off_thread(move || envelope(chat::chat_stop(handle))).await?
        }
        "chat_stop_session" => {
            let session_key = arg_str(&args, "sessionKey")?;
            off_thread(move || envelope(chat::chat_stop_session(session_key))).await?
        }
        "chat_stop_all" => off_thread(|| envelope(chat::chat_stop_all())).await?,

        // Sessions ------------------------------------------------------------
        "chat_sessions" => off_thread(|| envelope(sessions::chat_sessions())).await?,
        "chat_session_update" => {
            let session_path = arg_str(&args, "sessionPath")?;
            let pinned = args.get("pinned").and_then(Value::as_bool);
            let archived = args.get("archived").and_then(Value::as_bool);
            let title = arg_opt_str(&args, "title");
            off_thread(move || envelope(sessions::chat_session_update(session_path, pinned, archived, title))).await?
        }
        "chat_session_timing" => {
            let session_path = arg_str(&args, "sessionPath")?;
            off_thread(move || envelope(sessions::chat_session_timing(session_path))).await?
        }
        "chat_session_recover" => {
            let session_path = arg_str(&args, "sessionPath")?;
            off_thread(move || envelope(sessions::chat_session_recover(session_path))).await?
        }
        "chat_session_messages" => {
            let session_path = arg_str(&args, "sessionPath")?;
            let limit = arg_opt_usize(&args, "limit");
            envelope(sessions::chat_session_messages(session_path, limit).await)
        }
        "chat_session_branch" => {
            let session_path = arg_str(&args, "sessionPath")?;
            let message_index = arg_from(&args, "messageIndex")?;
            envelope(sessions::chat_session_branch(session_path, message_index).await)
        }
        "chat_flow_reports" => {
            let session_path = arg_str(&args, "sessionPath")?;
            off_thread(move || envelope(sessions::chat_flow_reports(session_path))).await?
        }

        // Attachments and workspace files ---------------------------------------
        "read_dropped_image" => {
            let path = arg_str(&args, "path")?;
            off_thread(move || envelope(attachments::read_dropped_image(path))).await?
        }
        "read_local_image" => {
            let workspace = arg_str(&args, "workspace")?;
            let path = arg_str(&args, "path")?;
            off_thread(move || envelope(attachments::read_local_image(workspace, path))).await?
        }
        "workspace_list" => {
            let path = arg_str(&args, "path")?;
            off_thread(move || envelope(attachments::workspace_list(path))).await?
        }
        "workspace_read" => {
            let path = arg_str(&args, "path")?;
            let workspace = arg_str(&args, "workspace")?;
            off_thread(move || envelope(attachments::workspace_read(path, workspace))).await?
        }
        "save_copy" => {
            let from = arg_str(&args, "from")?;
            let to = arg_str(&args, "to")?;
            off_thread(move || envelope(attachments::save_copy(from, to))).await?
        }
        "reveal_path" => {
            let path = arg_str(&args, "path")?;
            let workspace = arg_opt_str(&args, "workspace");
            off_thread(move || envelope(attachments::reveal_path(path, workspace))).await?
        }

        // Artifacts -------------------------------------------------------------
        "artifact_list" => {
            let kind = arg_opt_str(&args, "kind");
            let session_id = arg_opt_str(&args, "sessionId");
            off_thread(move || envelope(artifacts::artifact_list(kind, session_id))).await?
        }
        "artifact_counts" => off_thread(|| envelope(artifacts::artifact_counts())).await?,
        "artifact_read" => {
            let id = arg_str(&args, "id")?;
            off_thread(move || envelope(artifacts::artifact_read(id))).await?
        }
        "artifact_delete" => {
            let id = arg_str(&args, "id")?;
            off_thread(move || envelope(artifacts::artifact_delete(id))).await?
        }
        "artifact_store_copy" => {
            let workspace = arg_str(&args, "workspace")?;
            let path = arg_str(&args, "path")?;
            let session_id = arg_opt_str(&args, "sessionId");
            let prompt = arg_opt_str(&args, "prompt");
            off_thread(move || envelope(artifacts::artifact_store_copy(workspace, path, session_id, prompt))).await?
        }

        // Launcher state and workspaces -------------------------------------------
        "launcher_state" => off_thread(|| envelope(commands::launcher_state())).await?,
        "launch_jouzu" => {
            let path = arg_str(&args, "path")?;
            off_thread(move || envelope(commands::launch_jouzu(path))).await?
        }
        "add_workspaces" => {
            let paths = arg_from(&args, "paths")?;
            off_thread(move || envelope(commands::add_workspaces(paths))).await?
        }
        "forget_workspace" => {
            let id = arg_str(&args, "id")?;
            off_thread(move || envelope(commands::forget_workspace(id))).await?
        }

        // Runtime provisioning and reports -----------------------------------------
        "runtime_report" => off_thread(|| envelope(commands::runtime_report())).await?,
        "runtime_install" => envelope(commands::runtime_install().await),
        "component_versions" => off_thread(|| envelope(commands::component_versions())).await?,
        "console_repair_needed" => off_thread(|| envelope(commands::console_repair_needed())).await?,
        "repair_jouzu" => envelope(recovery::repair_jouzu().await),
        "mcp_config" => off_thread(|| envelope(commands::mcp_config())).await?,
        "diagnostics" => off_thread(|| envelope(commands::diagnostics())).await?,
        "crash_dismiss" => {
            let path = arg_str(&args, "path")?;
            off_thread(move || envelope(commands::crash_dismiss(path))).await?
        }
        "log_event" => {
            let message = arg_str(&args, "message")?;
            off_thread(move || envelope(commands::log_event(message))).await?
        }
        "bug_report" => {
            let description = arg_str(&args, "description")?;
            let expected = arg_str(&args, "expected")?;
            let actual = arg_str(&args, "actual")?;
            let reproduction = arg_str(&args, "reproduction")?;
            off_thread(move || envelope(commands::bug_report(description, expected, actual, reproduction))).await?
        }

        // Terminal, Git Bash, command entry ------------------------------------------
        "terminal" => off_thread(|| envelope(commands::terminal())).await?,
        "terminal_install" => envelope(commands::terminal_install().await),
        "terminal_open" => {
            let path = arg_opt_str(&args, "path");
            off_thread(move || envelope(commands::terminal_open(path))).await?
        }
        "git_bash" => off_thread(|| envelope(commands::git_bash())).await?,
        "git_bash_install" => envelope(commands::git_bash_install().await),
        "command_entry_report" => off_thread(|| envelope(commands::command_entry_report())).await?,
        "command_entry_use" => off_thread(|| envelope(commands::command_entry_use())).await?,
        "command_entry_repair" => off_thread(|| envelope(commands::command_entry_repair())).await?,
        "command_entry_remove" => off_thread(|| envelope(commands::command_entry_remove())).await?,

        // Configuration control and updates -------------------------------------------
        "control_request" => {
            let request = arg_value(&args, "request")?;
            envelope(control::control_request(request).await)
        }
        "cancel_control" => {
            control::cancel_control();
            envelope(Ok::<(), String>(()))
        }
        "jouzu_update" => {
            let action = arg_str(&args, "action")?;
            let version = arg_opt_str(&args, "version");
            envelope(jouzu_update::jouzu_update(action, version).await)
        }

        // Tools settings and image generation ------------------------------------------
        "tools_settings_read" => off_thread(|| envelope(image_tool::tools_settings_read())).await?,
        "tools_settings_save" => {
            let image = arg_value(&args, "image")?;
            off_thread(move || envelope(image_tool::tools_settings_save(image))).await?
        }
        "image_providers" => envelope(image_tool::image_providers().await),
        "image_models" => {
            let provider = arg_str(&args, "provider")?;
            envelope(image_tool::image_models(provider).await)
        }
        "image_tool_ensure" => off_thread(|| envelope(image_tool::image_tool_ensure())).await?,
        "image_fit_send" => {
            let data = arg_str(&args, "data")?;
            let mime_type = arg_str(&args, "mimeType")?;
            off_thread(move || envelope(crate::image_fit::fit_send(&data, &mime_type))).await?
        }

        // Environment variables -----------------------------------------------------------
        "environment_read" => off_thread(|| envelope(environment::environment_read())).await?,
        "environment_save" => {
            let entries = arg_from(&args, "entries")?;
            off_thread(move || envelope(environment::environment_save(entries))).await?
        }

        // Desktop services: engine thread, NSH APIs ------------------------------------------
        "open_external_url" => {
            let url = arg_str(&args, "url")?;
            envelope(commands::open_external_url(url).await)
        }
        "open_logs" => envelope(commands::open_logs().await),

        other => return Err(format!("Unknown command: {other}")),
    };
    Ok(response)
}