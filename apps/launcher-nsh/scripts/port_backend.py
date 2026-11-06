"""One-shot mechanical port of the copied Tauri backend modules to NSH.

Run from the repo root after copying src-tauri modules into src/backend.
Idempotent: patterns that no longer match are simply skipped.
"""
import re
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent / "src" / "backend"


def sub_functions(text):
    """Strip tauri parameters from function signatures; bind the service locally."""
    pattern = re.compile(r"(pub (?:async )?fn \w+\()([^)]*)(\) -> [^{]+)\{")

    def fix(match):
        head, params, tail = match.groups()
        had_state = "tauri::State" in params
        kept = []
        for param in params.split(","):
            stripped = param.strip()
            if not stripped:
                continue
            if "tauri::AppHandle" in stripped or "tauri::WebviewWindow" in stripped or "tauri::State" in stripped:
                continue
            kept.append(param)
        params_text = ",".join(kept)
        if kept and not params_text.endswith((" ", "\n")) and "\n" not in params_text:
            params_text += ", " if params.rstrip().endswith(",") else ""
        body = "\n    let state = service();" if had_state else ""
        return f"{head}{params_text}{tail}{{{body}"

    return pattern.sub(fix, text)


def common(text):
    text = text.replace("window.label()", '"main"')
    text = re.sub(r"application_root\(&?app\)", "application_root()", text)
    text = re.sub(r"find_bash\(&?app\)", "find_bash()", text)
    return text


def port_chat(text):
    text = sub_functions(text)
    text = common(text)
    # The single-window restriction was a Tauri window guard; NSH has one surface.
    text = text.replace('    if "main" != "main" {\n        return Err("Chat is restricted to the main window".into());\n    }\n', "")
    service = """
/// The process-wide chat service. Tauri kept it as managed state; NSH keeps it
/// here for the lifetime of the process, shut down when the app exits.
static SERVICE: std::sync::OnceLock<ChatService> = std::sync::OnceLock::new();
pub fn service() -> &'static ChatService {
    SERVICE.get_or_init(ChatService::default)
}
"""
    if "static SERVICE" not in text:
        text = text.replace("#[derive(Default)]\npub struct ChatService", service + "\n#[derive(Default)]\npub struct ChatService")
    return text


def port_runtime(text):
    text = text.replace("pub fn application_root(_app: &tauri::AppHandle)", "pub fn application_root()")
    text = text.replace("pub fn find_bash(app: &tauri::AppHandle)", "pub fn find_bash()")
    text = text.replace("pub fn launch(app: &tauri::AppHandle, path: &str)", "pub fn launch(path: &str)")
    return common(text)


def port_control(text):
    text = sub_functions(text)
    text = common(text)
    text = text.replace("        let event_app = app.clone();\n", "")
    text = text.replace('let _ = event_app.emit("control-device", value);', 'crate::events::publish("control-device", value);')
    return text


def port_jouzu_update(text):
    text = text.replace(
        "pub async fn jouzu_update(app: tauri::AppHandle, chat: tauri::State<'_, crate::chat::ChatService>, action: String, version: Option<String>)",
        "pub async fn jouzu_update(action: String, version: Option<String>)",
    )
    text = text.replace("chat.pause();", "crate::chat::service().pause();")
    text = text.replace("  let events=app.clone();\n", "")
    text = text.replace('let _=events.emit("jouzu-update-progress",value);', 'crate::events::publish("jouzu-update-progress",value);')
    return common(text)


def port_recovery(text):
    text = sub_functions(text)
    return common(text)


def port_bug_report(text):
    text = text.replace("    app: &tauri::AppHandle,\n", "")
    return common(text)


PORTS = {
    "chat.rs": port_chat,
    "runtime.rs": port_runtime,
    "control.rs": port_control,
    "jouzu_update.rs": port_jouzu_update,
    "recovery.rs": port_recovery,
    "bug_report.rs": port_bug_report,
}

for file in BACKEND.glob("*.rs"):
    text = file.read_text(encoding="utf-8")
    original = text
    if file.name in PORTS:
        text = PORTS[file.name](text)
    if text != original:
        file.write_text(text, encoding="utf-8")
        print(f"ported {file.name}")

leftovers = []
for file in BACKEND.glob("*.rs"):
    for number, line in enumerate(file.read_text(encoding="utf-8").splitlines(), 1):
        if "tauri" in line:
            leftovers.append(f"{file.name}:{number}: {line.strip()}")
print("remaining tauri references:")
print("\n".join(leftovers) or "  (none)")