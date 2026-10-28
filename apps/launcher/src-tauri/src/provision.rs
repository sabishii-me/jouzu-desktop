use std::path::{Path, PathBuf};
use std::process::Command;

/// Files a runtime package must carry before it can be installed.
pub const REQUIRED: [&str; 3] = [
    "app/bootstrap.mjs",
    "app/node_modules/jouzu/package.json",
    "runtime/node/node.exe",
];

pub fn validate_payload(source: &Path) -> Result<(), String> {
    if !source.is_dir() {
        return Err("The runtime package folder does not exist.".into());
    }
    for entry in REQUIRED {
        if !source.join(entry).is_file() {
            return Err(format!("The runtime package is missing {entry}."));
        }
    }
    Ok(())
}

fn copy_dir(from: &Path, to: &Path) -> Result<(), String> {
    std::fs::create_dir_all(to).map_err(|error| format!("Could not create {}: {error}", to.display()))?;
    for entry in std::fs::read_dir(from).map_err(|error| format!("Could not read {}: {error}", from.display()))? {
        let entry = entry.map_err(|error| error.to_string())?;
        let target = to.join(entry.file_name());
        let kind = entry.file_type().map_err(|error| error.to_string())?;
        if kind.is_dir() {
            copy_dir(&entry.path(), &target)?;
        } else if kind.is_file() {
            std::fs::copy(entry.path(), &target)
                .map_err(|error| format!("Could not copy {}: {error}", entry.path().display()))?;
        }
        // Symlinks are skipped: a runtime package is a plain tree.
    }
    Ok(())
}

fn version_of(app: &Path) -> Result<String, String> {
    let text = std::fs::read_to_string(app.join("node_modules/jouzu/package.json"))
        .map_err(|_| "Runtime metadata is unavailable")?;
    let value: serde_json::Value = serde_json::from_str(&text).map_err(|_| "Runtime metadata is invalid")?;
    value
        .get("version")
        .and_then(|item| item.as_str())
        .map(str::to_string)
        .ok_or_else(|| "Runtime version is missing".to_string())
}

/// The staged runtime must answer a health check before the app trusts it.
fn check_health(managed: &Path) -> Result<(), String> {
    let node = managed.join("runtime/node/node.exe");
    let app = managed.join("app");
    let version = version_of(&app)?;
    let script = managed.join("runtime/launcher-update/check-update-health.mjs");
    let mut command = Command::new(&node);
    if script.is_file() {
        command
            .arg("--input-type=module")
            .arg("--eval")
            .arg("import {pathToFileURL} from 'node:url'; const [script,app,version]=process.argv.slice(1); const {checkStagedHealth}=await import(pathToFileURL(script)); await checkStagedHealth({node:process.execPath,app,version});")
            .arg(&script)
            .arg(&app)
            .arg(&version);
    } else {
        // A package without the launcher's health script still has to prove Node runs.
        command.arg("--version");
    }
    command.env_remove("NODE_OPTIONS").env_remove("NODE_PATH");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let output = command.output().map_err(|_| "Cannot run the installed runtime")?;
    if !output.status.success() {
        return Err("The runtime package failed its startup check.".into());
    }
    Ok(())
}

/// Install a runtime package into the managed root. A working install is never replaced.
pub fn install_payload(source: &Path, managed: &Path) -> Result<(), String> {
    validate_payload(source)?;
    let app = managed.join("app");
    if app.join("bootstrap.mjs").is_file() {
        return Err("A runtime is already installed. Repair it instead.".into());
    }
    let runtime = managed.join("runtime");
    let staging = managed.join("runtime-install.tmp");
    if staging.exists() {
        std::fs::remove_dir_all(&staging).map_err(|error| format!("Could not clear the previous attempt: {error}"))?;
    }
    copy_dir(&source.join("app"), &staging.join("app"))?;
    copy_dir(&source.join("runtime"), &staging.join("runtime"))?;
    // No app means no usable runtime, so a leftover directory is safe to replace.
    if runtime.exists() {
        std::fs::remove_dir_all(&runtime).map_err(|error| format!("Could not replace the old runtime files: {error}"))?;
    }
    std::fs::rename(staging.join("app"), &app).map_err(|error| format!("Could not install the runtime app: {error}"))?;
    if let Err(error) = std::fs::rename(staging.join("runtime"), &runtime) {
        let _ = std::fs::remove_dir_all(&app);
        return Err(format!("Could not install the runtime files: {error}"));
    }
    let _ = std::fs::remove_dir_all(&staging);
    if let Err(error) = check_health(managed) {
        let _ = std::fs::remove_dir_all(&app);
        let _ = std::fs::remove_dir_all(&runtime);
        return Err(error);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn package(root: &Path) {
        for entry in REQUIRED {
            let path = root.join(entry);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, b"x").unwrap();
        }
    }

    #[test]
    fn a_complete_package_passes_and_an_incomplete_one_names_the_missing_file() {
        let dir = tempfile::tempdir().unwrap();
        package(dir.path());
        validate_payload(dir.path()).unwrap();

        std::fs::remove_file(dir.path().join("runtime/node/node.exe")).unwrap();
        let error = validate_payload(dir.path()).unwrap_err();
        assert!(error.contains("runtime/node/node.exe"), "{error}");
    }

    #[test]
    fn a_working_install_is_never_replaced() {
        let source = tempfile::tempdir().unwrap();
        package(source.path());
        let managed = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(managed.path().join("app")).unwrap();
        std::fs::write(managed.path().join("app/bootstrap.mjs"), b"existing").unwrap();

        let error = install_payload(source.path(), managed.path()).unwrap_err();
        assert!(error.contains("already installed"), "{error}");
        assert_eq!(std::fs::read(managed.path().join("app/bootstrap.mjs")).unwrap(), b"existing");
    }

    #[test]
    fn a_package_without_its_required_files_is_refused_before_anything_is_copied() {
        let source = tempfile::tempdir().unwrap();
        let managed = tempfile::tempdir().unwrap();
        let error = install_payload(source.path(), managed.path()).unwrap_err();
        assert!(error.contains("missing"), "{error}");
        assert!(!managed.path().join("runtime-install.tmp").exists());
    }
}
