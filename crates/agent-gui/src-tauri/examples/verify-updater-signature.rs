//! Verify Tauri updater signatures against the public key used by the build.
//!
//! This example is a release/build tool, not a packaged application command. It
//! intentionally reuses the same `minisign-verify` implementation that the
//! Tauri updater plugin uses at runtime, so a release cannot pass with a
//! mismatched public key secret.

use minisign_verify::{PublicKey, Signature};
use std::{env, fs::File, io::Read, path::PathBuf};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let files: Vec<PathBuf> = env::args_os().skip(1).map(PathBuf::from).collect();
    if files.is_empty() {
        return Err("usage: verify-updater-signature <artifact> [<artifact> ...]".into());
    }

    let public_key = env::var("CALEN_UPDATER_PUBLIC_KEY")
        .or_else(|_| env::var("TAURI_UPDATER_PUBLIC_KEY"))
        .map_err(|_| "CALEN_UPDATER_PUBLIC_KEY or TAURI_UPDATER_PUBLIC_KEY is required")?;
    let public_key = PublicKey::from_base64(public_key.trim())?;

    for artifact in files {
        let mut signature_path = artifact.as_os_str().to_owned();
        signature_path.push(".sig");
        let signature_path = PathBuf::from(signature_path);
        let signature = Signature::from_file(&signature_path)?;
        let mut verifier = public_key.verify_stream(&signature)?;
        let mut input = File::open(&artifact)?;
        // Keep the streaming buffer off the 1 MiB Windows main-thread stack.
        let mut buffer = vec![0_u8; 64 * 1024];
        loop {
            let read = input.read(&mut buffer)?;
            if read == 0 {
                break;
            }
            verifier.update(&buffer[..read]);
        }
        verifier.finalize()?;
        println!("verified {} with {}", artifact.display(), signature_path.display());
    }

    Ok(())
}
