//! Verify Tauri updater signatures against the public key used by the build.
//!
//! This example is a release/build tool, not a packaged application command. It
//! intentionally reuses the same `minisign-verify` implementation that the
//! Tauri updater plugin uses at runtime, so a release cannot pass with a
//! mismatched public key secret.

use base64::{engine::general_purpose::STANDARD, Engine as _};
use minisign_verify::{PublicKey, Signature};
use std::{env, fs, fs::File, io::Read, path::PathBuf};

type DynError = Box<dyn std::error::Error>;

fn parse_updater_public_key(value: &str) -> Result<PublicKey, DynError> {
    let value = value.trim();
    if value.starts_with("untrusted comment:") {
        return Ok(PublicKey::decode(value)?);
    }

    let decoded = STANDARD.decode(value)?;
    if decoded.len() == 42 {
        return Ok(PublicKey::from_base64(value)?);
    }
    let decoded = String::from_utf8(decoded)?;
    Ok(PublicKey::decode(decoded.trim())?)
}

fn parse_updater_signature(value: &str) -> Result<Signature, DynError> {
    let value = value.trim();
    if value.starts_with("untrusted comment:") {
        return Ok(Signature::decode(value)?);
    }

    let decoded = String::from_utf8(STANDARD.decode(value)?)?;
    Ok(Signature::decode(decoded.trim())?)
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let files: Vec<PathBuf> = env::args_os().skip(1).map(PathBuf::from).collect();
    if files.is_empty() {
        return Err("usage: verify-updater-signature <artifact> [<artifact> ...]".into());
    }

    let public_key = env::var("CALEN_UPDATER_PUBLIC_KEY")
        .or_else(|_| env::var("TAURI_UPDATER_PUBLIC_KEY"))
        .map_err(|_| "CALEN_UPDATER_PUBLIC_KEY or TAURI_UPDATER_PUBLIC_KEY is required")?;
    let public_key = parse_updater_public_key(&public_key)?;

    for artifact in files {
        let mut signature_path = artifact.as_os_str().to_owned();
        signature_path.push(".sig");
        let signature_path = PathBuf::from(signature_path);
        let signature_payload = fs::read_to_string(&signature_path)?;
        let signature = parse_updater_signature(&signature_payload)?;
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

#[cfg(test)]
mod tests {
    use super::*;
    use base64::Engine as _;

    const PUBLIC_KEY: &str = concat!(
        "untrusted comment: minisign public key E7620F1842B4E81F\n",
        "RWQf6LRCGA9i53mlYecO4IzT51TGPpvWucNSCh1CBM0QTaLn73Y7GFO3"
    );
    const SIGNATURE: &str = concat!(
        "untrusted comment: signature from minisign secret key\n",
        "RUQf6LRCGA9i559r3g7V1qNyJDApGip8MfqcadIgT9CuhV3EMhHoN1mGTkUidF/",
        "z7SrlQgXdy8ofjb7bNJJylDOocrCo8KLzZwo=\n",
        "trusted comment: timestamp:1633700835\tfile:test\tprehashed\n",
        "wLMDjy9FLAuxZ3q4NlEvkgtyhrr0gtTu6KC4KBJdITbbOeAi1zBIYo0v4iTgt8jJ",
        "pIidRJnp94ABQkJAgAooBQ=="
    );

    #[test]
    fn parses_tauri_base64_wrapped_minisign_payloads() {
        let public_key = parse_updater_public_key(&STANDARD.encode(PUBLIC_KEY)).unwrap();
        assert_eq!(
            public_key.untrusted_comment(),
            Some("untrusted comment: minisign public key E7620F1842B4E81F")
        );

        let signature = parse_updater_signature(&STANDARD.encode(SIGNATURE)).unwrap();
        assert_eq!(
            signature.untrusted_comment(),
            "untrusted comment: signature from minisign secret key"
        );
        assert_eq!(
            signature.trusted_comment(),
            "timestamp:1633700835\tfile:test\tprehashed"
        );
    }
}
