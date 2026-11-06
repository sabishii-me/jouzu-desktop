"""Extract the command bodies from the Tauri main.rs into backend/commands.rs."""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT.parent / "launcher" / "src-tauri" / "src" / "main.rs"
DST = ROOT / "src" / "backend" / "commands.rs"

text = SRC.read_text(encoding="utf-8")

# Drop the crate-level attribute and module declarations; keep the rest.
text = text.replace('#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]\n', "")
text = re.sub(r"^(#\[cfg\((windows|unix)\)\]\n)?(#\[path = \"[^\"]+\"\]\n)?mod \w+;\n", "", text, flags=re.M)

# Cut the runner-specific blocks (from each marker to the next top-level item).
def cut_block(text, start_marker, end_marker):
    start = text.index(start_marker)
    end = text.index(end_marker, start)
    return text[:start] + text[end:]

text = cut_block(text, "/// The webview loads a development server", "fn show_main(")
text = cut_block(text, "fn show_main(", "#[cfg(test)]\nmod tests")
text = text[: text.index("#[cfg(test)]\nmod build_check_tests")]

# Mechanical command transforms.
text = text.replace("#[tauri::command]\n", "")
text = text.replace("    app: tauri::AppHandle,\n", "")
text = text.replace("(app: tauri::AppHandle)", "()")
text = text.replace("(app: tauri::AppHandle, ", "(")
text = re.sub(r"application_root\(&app\)", "application_root()", text)
text = re.sub(r"find_bash\(&app\)", "find_bash()", text)
text = text.replace("runtime::launch(&app, &path)", "runtime::launch(&path)")
text = text.replace("bug_report::draft(&app, ", "bug_report::draft(")
text = text.replace("launcher_state(app.clone())", "launcher_state()")
text = text.replace("launcher_state(app)", "launcher_state()")
text = text.replace("tauri::async_runtime::spawn_blocking", "nsh_core::prelude::blocking")

# The updater plugin flags described the Tauri shell; NSH ships no self-updater yet.
start = text.index("    let launcher_updater = app")
end = text.index("    let root = runtime::application_root()", start)
text = (
    text[:start]
    + "    // The Tauri shell updater is not ported (PORTING.md); the runtime updater below is.\n"
    + "    let launcher_updater = false;\n"
    + text[end:]
)

# Progress events go to the in-process bus instead of a webview emit.
text = text.replace(
    '        let emit = |value: serde_json::Value| { let _ = tauri::Emitter::emit(&handle, "runtime-install-progress", value); };\n',
    '        let emit = |value: serde_json::Value| { crate::events::publish("runtime-install-progress", value); };\n',
)
text = text.replace("    let handle = app.clone();\n", "")
# Opener-plugin commands become NSH desktop services (engine-thread, async).
text = text.replace(
    """fn open_external_url(url: String) -> Result<(), String> {
    let parsed = external_http_url(&url)?;
    tauri_plugin_opener::OpenerExt::opener(&app)
        .open_url(parsed.to_string(), None::<&str>)
        .map_err(|_| "Could not open link.".to_string())
}""",
    """async fn open_external_url(url: String) -> Result<(), String> {
    let parsed = external_http_url(&url)?;
    if nsh_core::prelude::open_url(parsed.to_string()).await {
        Ok(())
    } else {
        Err("Could not open link.".to_string())
    }
}""",
)
text = text.replace(
    """fn open_logs() -> Result<(), String> {
    let directory = logs::directory(&runtime::managed_root()?);
    std::fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    tauri_plugin_opener::OpenerExt::opener(&app)
        .open_path(directory.to_string_lossy().to_string(), None::<&str>)
        .map_err(|error| error.to_string())
}""",
    """async fn open_logs() -> Result<(), String> {
    let directory = logs::directory(&runtime::managed_root()?);
    std::fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    nsh_core::prelude::open_path(directory)
        .await
        .map_err(|error| error.to_string())?
}""",
)

header = """//! Launcher commands ported from the Tauri shell's main.rs. The bodies keep the
//! baseline behavior; the dispatch in bridge.rs names them the same way the
//! frontend's invoke() always has.

use crate::{
    active_app, bug_report, chat, command_path, environment, git_environment, logs,
    migration, runtime, terminal,
};
"""
text = header + text

# Everything the bridge dispatches to must be visible in this module's parent.
text = re.sub(r"^fn (\w+)", r"pub fn \1", text, flags=re.M)
text = re.sub(r"^async fn (\w+)", r"pub async fn \1", text, flags=re.M)

DST.write_text(text, encoding="utf-8")
print(f"wrote {DST} ({len(text.splitlines())} lines)")
for number, line in enumerate(text.splitlines(), 1):
    if "tauri" in line or "app." in line:
        print(f"  check {number}: {line.strip()}")