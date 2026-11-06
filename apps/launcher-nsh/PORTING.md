# Porting Jouzu Desktop 1.0.15 from Tauri to NSH

Baseline: `v1.0.15` of `apps/launcher` (Tauri 2 shell + React 19 UI).
Target: NSH (https://nsh.dev) mixed app — TSX screens on the native engine,
business logic in a Rust crate exported as native modules.

## Architecture mapping

| Tauri (baseline) | NSH (this app) |
| --- | --- |
| `src-tauri` crate, `#[tauri::command]` functions | `src/backend/` modules, plain functions dispatched by a native `Backend.invoke(command, argsJson)` module |
| `invoke()` from `@tauri-apps/api/core` | `src/host/invoke.ts` shim calling `Backend.invoke`, JSON in/out (same wire contract) |
| `tauri::AppHandle` | Removed. `runtime::application_root()` already ignores the handle; all paths come from `managed_paths` |
| `tauri::WebviewWindow` (owner label `"main"`) | Constant owner `"main"` — NSH app is a single window |
| `tauri::State<ChatService>` | Process-wide `OnceLock<ChatService>` (`chat::service()`) |
| `Emitter::emit` (`runtime-install-progress`, `control-device`, `jouzu-update-progress`, `new-session`) | In-process event bus; TSX subscribes via `Events.on(name, cb)` returning an unsubscribe function |
| `tauri::async_runtime::spawn_blocking` | `nsh_core` blocking/background task helper |
| `tauri-plugin-dialog` (folder picker) | `nsh_core::file_dialog::pick_paths` exposed as `Backend.pickFolders()` |
| `tauri-plugin-opener` (`open_external_url`, `open_logs`, reveal) | `nsh_core` `open_path` / `reveal_path`; the URL policy check is kept verbatim |
| React 19 + radix-ui + Tailwind v4 | NSH TSX components (signals, `nsh/base`, Tailwind classes, shadcn-style theme tokens) |
| `react-markdown` + `rehype-highlight` | `nsh/base` `TextView` (native markdown/code rendering) |
| Vitest unit tests | `nsh test` (`*.test.tsx` / `*.test.ts`) for UI; `cargo test` for backend logic (ported tests kept) |

## What is reused verbatim (or nearly)

Tauri-free modules copied without behavior changes: `chat_process`,
`chat_process_unix`, `chat_transport`, `managed_paths`, `active_app`,
`launcher_script`, `terminal`, `git_environment`, `logs`, `command_path`,
`migration`, `runtime_install`, `node_path`, `update_lock`, `components`.

Modules with mechanical edits only (drop command attribute, handle, window,
state parameters; emit through the event bus): `chat`, `sessions`,
`attachments`, `artifacts`, `image_tool`, `control`, `jouzu_update`,
`recovery`, `environment`, `bug_report`, `runtime`.

`main.rs` command bodies become `src/backend/commands.rs`; its window/tray/
plugin setup is replaced by the NSH runner and `App.tsx`.

## Deliberate gaps (documented, not silently dropped)

- **Tray icon + close-to-tray**: NSH has no tray API. Closing the window quits;
  chat runtimes are shut down on exit (`ChatService::shutdown`).
- **Launcher self-update (`tauri-plugin-updater`)**: not ported. The runtime
  updater (`jouzu_update`, script-based) is ported; the shell updater UI shows
  `launcherUpdaterConfigured: false`.
- **Single-instance plugin**: not ported yet (NSH provides no equivalent).
- **WebView2 renderer-failure recovery (`renderer.rs`)**: obsolete — NSH does
  not use a WebView; crash logging via the panic hook is kept.
- **Playwright e2e**: cannot drive a native NSH window; replaced by `nsh test`
  headless tests.
- **Window focus update checks**: NSH has no window-focus event; the periodic
  update schedule still runs (`update-schedule.ts`).
- **Rename session** uses an in-app dialog instead of `window.prompt`.
- **Pane resize** uses the gesture responder instead of pointer events.
- **Close-to-tray**: the custom title bar is restored (see below), but its close
  button is the platform's own, which quits — NSH has no tray to hide into.

## Feature-parity fixes (after first live review)

- **Connecting-page loop**: the full-window loader is guarded by `entryReady`
  exactly as the baseline (`entryBooting && !entryReady`); once the entry
  session connects, later disconnects show the chat's own line, not the loader.
- **Custom title bar**: restored via `Window.setTitleBar({style:"hidden"})` +
  a `windowDrag` region with the JZ mark, "Jouzu" and the DEV badge; the
  platform caption buttons (minimize/maximize/close) stay in `titleBar()`'s
  reserved area. Window title set to "Jouzu".
- **Ctrl/Cmd+,** opens settings (`keymap.bind("mod+,")`).
- **Status-error copy** button on the connecting screen (`Clipboard.writeText`).
- **DEV badge** driven by the backend's `component_versions.development`.
- Audited and confirmed as baseline dead code (not ported, no parity loss):
  the App-level folder drag-drop (`listRef` never attached), `launchTerminal`,
  and the launcher-list `sort`/`query` filtering.

## Verification (2026-11-06, Windows)

- `nsh check`: passes (cargo check + TypeScript, whole app).
- `nsh test`: 126 tests — 124 passed, 0 failed, 2 ignored (the baseline's
  ignored Rust tests), including the headless UI smoke test.
- `nsh run`: live Win32 window verified by screenshot — sidebar with real
  workspaces and session history from the managed runtime, hero composer,
  model picker populated from the live runtime, settings reachable.
- Cosmetic gaps: NSH warns on `break-all`, `break-words`, `whitespace-pre*`
  and one opacity-suffixed token class it does not implement; long tool
  output wraps differently than the baseline until NSH grows those utilities.

## Layout

```
apps/launcher-nsh/
  nsh.json            NSH app manifest (id com.shisa-ai.jouzu.desktop)
  App.tsx             entry: launcher page / chat workspace switch
  src/                TSX screens and logic ported from apps/launcher/src
    host/             invoke/listen shims over jouzu-desktop/native
    ui/               design-system components (button, dialog, ...)
  src/backend/        Rust modules ported from src-tauri/src
  src/lib.rs          #[native_module("jouzu-desktop/native")]: Backend, Events
  theme.json          shadcn cssVars theme matching the baseline styles.css
```