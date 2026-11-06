//! The launcher backend, ported from apps/launcher/src-tauri (v1.0.15).
//! Modules keep the baseline names; lib.rs re-exports them at the crate root
//! so the original `crate::…` paths keep working.

pub mod active_app;
pub mod artifacts;
pub mod attachments;
pub mod bridge;
pub mod bug_report;
pub mod chat;
#[cfg(windows)]
pub mod chat_process;
#[cfg(unix)]
#[path = "chat_process_unix.rs"]
pub mod chat_process;
pub mod chat_transport;
pub mod command_path;
pub mod commands;
pub mod control;
pub mod environment;
pub mod events;
pub mod git_environment;
pub mod image_tool;
pub mod jouzu_update;
pub mod launcher_script;
pub mod logs;
pub mod managed_paths;
pub mod migration;
pub mod node_path;
pub mod recovery;
pub mod runtime;
pub mod runtime_install;
pub mod sessions;
pub mod terminal;
pub mod update_lock;