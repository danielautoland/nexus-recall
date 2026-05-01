//! Persisted app config at ~/.nexus-recall/config.json.
//!
//! Single source of truth for the vault path: env var still wins
//! (so existing dev setups keep working), but if nothing is set
//! we fall back to whatever the user picked in the Setup UI.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Serialize, Deserialize, Clone, Default, Debug)]
pub struct Config {
    pub vault_path: Option<String>,
}

fn config_path() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or_else(|| "no home dir".to_string())?;
    Ok(home.join(".nexus-recall").join("config.json"))
}

pub fn load() -> Config {
    let Ok(path) = config_path() else {
        return Config::default();
    };
    let Ok(raw) = std::fs::read_to_string(&path) else {
        return Config::default();
    };
    serde_json::from_str(&raw).unwrap_or_default()
}

pub fn save(cfg: &Config) -> Result<(), String> {
    let path = config_path()?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let raw = serde_json::to_string_pretty(cfg).map_err(|e| e.to_string())?;
    std::fs::write(&path, raw).map_err(|e| e.to_string())?;
    Ok(())
}

/// Resolve the effective vault path: env var > config file > None.
pub fn resolve_vault_path() -> Option<String> {
    if let Ok(env) = std::env::var("NEXUS_VAULT_PATH") {
        if !env.is_empty() {
            return Some(env);
        }
    }
    load().vault_path.filter(|s| !s.is_empty())
}
