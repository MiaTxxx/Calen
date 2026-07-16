#[path = "../../agent-gui/src-tauri/src/commands/stock_portfolio/types.rs"]
mod types;
#[path = "../../agent-gui/src-tauri/src/commands/stock_portfolio/repository.rs"]
mod repository;
#[path = "../../agent-gui/src-tauri/src/commands/stock_portfolio/cipher.rs"]
mod cipher;
#[path = "../../agent-gui/src-tauri/src/commands/stock_portfolio/csv.rs"]
mod csv;
#[path = "../../agent-gui/src-tauri/src/commands/stock_portfolio/ports.rs"]
pub mod ports;

pub use repository::{BackupCipher, StockPortfolioRepository};
pub use types::*;

fn safe_file_stem(value: &str, fallback: &str) -> String {
    let sanitized: String = value
        .chars()
        .map(|character| match character {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '_',
            character if character.is_control() => '_',
            character => character,
        })
        .collect();
    let sanitized = sanitized
        .trim()
        .trim_end_matches(|character| character == '.' || character == ' ');
    if sanitized.is_empty() {
        fallback.to_string()
    } else {
        sanitized.to_string()
    }
}

#[cfg(test)]
#[path = "../../agent-gui/src-tauri/src/commands/stock_portfolio/tests.rs"]
mod tests;
