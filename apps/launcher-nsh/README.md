# Jouzu Desktop (NSH)

The Jouzu Desktop launcher ported from Tauri 2 + React to [NSH](https://nsh.dev)
(Native Shell): TSX screens on the native engine, the launcher backend as a
Rust crate exported through `jouzu-desktop/native`. Baseline: `v1.0.15` of
`apps/launcher`. See `PORTING.md` for the architecture mapping and the
deliberate gaps.

## Requirements

- `nsh` 0.4.0 or newer on `PATH` (https://nsh.dev/docs/installation)
- Rust via rustup; `rust-toolchain.toml` pins stable (NSH needs a recent one)

## Develop

```bash
nsh run            # Win32 window on Windows, hot reload for TSX
nsh check          # cargo check + TypeScript
nsh test           # headless: cargo tests + nsh UI tests
```

The Rust backend lives in `src/backend` (ported from `src-tauri`); the console
binary (`src/bin/console.rs`) builds with `cargo build --bin console` and is
the terminal entry `launch_jouzu` starts. The TSX screens are in `src/`, the
UI kit in `src/ui` (contract in `src/ui/README.md`), and the host shims that
replace the Tauri APIs in `src/host`.

## Package

```bash
nsh package --target windows
```

Packaging the runtime provisioning payloads (`packaging/launcher`) alongside
the NSH app is not wired yet; the baseline packaging scripts under
`packaging/` still describe the Tauri layout.