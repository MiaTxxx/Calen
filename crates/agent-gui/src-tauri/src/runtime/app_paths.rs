//! Application data directory resolution for Calen.
//!
//! Branding prefers `~/.calen`. Existing installs that already store data under
//! the legacy `~/.liveagent` directory keep using that path so config, history,
//! and portfolio data are not orphaned. Fresh installs always create `~/.calen`.

use std::fs;
use std::path::PathBuf;

pub const CALEN_DATA_DIR_NAME: &str = ".calen";
pub const LEGACY_LIVEAGENT_DATA_DIR_NAME: &str = ".liveagent";

fn home_dir() -> Result<PathBuf, String> {
    dirs::home_dir().ok_or_else(|| "无法定位用户主目录".to_string())
}

/// Prefer `~/.calen`. If it does not exist yet but the legacy `~/.liveagent`
/// directory already holds data, keep using the legacy path for compatibility.
/// Otherwise create and return `~/.calen`.
pub fn app_data_dir() -> Result<PathBuf, String> {
    let home = home_dir()?;
    let preferred = home.join(CALEN_DATA_DIR_NAME);
    let legacy = home.join(LEGACY_LIVEAGENT_DATA_DIR_NAME);

    if preferred.is_dir() {
        return Ok(preferred);
    }
    if legacy.is_dir() {
        return Ok(legacy);
    }

    fs::create_dir_all(&preferred).map_err(|e| format!("创建 Calen 数据目录失败：{e}"))?;
    Ok(preferred)
}

/// Ensure `app_data_dir()/child` exists and return it.
pub fn app_data_subdir(child: &str) -> Result<PathBuf, String> {
    let dir = app_data_dir()?.join(child);
    fs::create_dir_all(&dir).map_err(|e| format!("创建数据子目录失败：{e}"))?;
    Ok(dir)
}

/// Cosmetic display helper: never surface the old LiveAgent directory name in UI.
pub fn display_app_data_path(path: &str) -> String {
    path.replace(LEGACY_LIVEAGENT_DATA_DIR_NAME, CALEN_DATA_DIR_NAME)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn display_path_masks_legacy_name() {
        assert_eq!(
            display_app_data_path(r"C:\Users\chen\.liveagent\default-project"),
            r"C:\Users\chen\.calen\default-project"
        );
        assert_eq!(
            display_app_data_path("/home/chen/.liveagent/default-project"),
            "/home/chen/.calen/default-project"
        );
        assert_eq!(
            display_app_data_path("/home/chen/.calen/default-project"),
            "/home/chen/.calen/default-project"
        );
    }
}
