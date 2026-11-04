# Local acceptance run for the bugfix batch.
# Isolated managed root: nothing here touches the installed Jouzu Desktop data.
$env:JOUZU_LAUNCHER_DEV_HOME = Join-Path $env:LOCALAPPDATA 'Shisa.ai\JouzuDesktopDev'
$env:CARGO_TARGET_DIR = 'C:\Users\colin\Documents\jouzu-desktop-repo\apps\launcher\src-tauri\target'
Set-Location (Join-Path $PSScriptRoot 'apps\launcher')
npm run tauri dev