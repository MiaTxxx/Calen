use argon2::Argon2;
use chacha20poly1305::{
    aead::{Aead, KeyInit},
    XChaCha20Poly1305, XNonce,
};
use zeroize::Zeroize;

use super::repository::BackupCipher;

const MAGIC: &[u8; 9] = b"CALENSTK1";
const SALT_LEN: usize = 16;
const NONCE_LEN: usize = 24;
const KEY_LEN: usize = 32;

pub struct CalenBackupCipher;

impl CalenBackupCipher {
    fn derive_key(password: &str, salt: &[u8]) -> Result<[u8; KEY_LEN], String> {
        let mut key = [0_u8; KEY_LEN];
        Argon2::default()
            .hash_password_into(password.as_bytes(), salt, &mut key)
            .map_err(|error| format!("derive stock backup key: {error}"))?;
        Ok(key)
    }
}

impl BackupCipher for CalenBackupCipher {
    fn algorithm(&self) -> &str {
        "argon2id+xchacha20poly1305-v1"
    }

    fn encrypt(&self, plaintext: &[u8], password: &str) -> Result<Vec<u8>, String> {
        let mut salt = [0_u8; SALT_LEN];
        let mut nonce = [0_u8; NONCE_LEN];
        getrandom::fill(&mut salt)
            .map_err(|error| format!("generate stock backup salt: {error}"))?;
        getrandom::fill(&mut nonce)
            .map_err(|error| format!("generate stock backup nonce: {error}"))?;
        let mut key = Self::derive_key(password, &salt)?;
        let cipher = XChaCha20Poly1305::new_from_slice(&key);
        key.zeroize();
        let cipher = cipher.map_err(|error| format!("initialize stock backup cipher: {error}"))?;
        let ciphertext = cipher
            .encrypt(XNonce::from_slice(&nonce), plaintext)
            .map_err(|_| "encrypt stock portfolio backup failed".to_string())?;

        let mut payload = Vec::with_capacity(MAGIC.len() + SALT_LEN + NONCE_LEN + ciphertext.len());
        payload.extend_from_slice(MAGIC);
        payload.extend_from_slice(&salt);
        payload.extend_from_slice(&nonce);
        payload.extend_from_slice(&ciphertext);
        Ok(payload)
    }

    fn decrypt(&self, ciphertext: &[u8], password: &str) -> Result<Vec<u8>, String> {
        let header_len = MAGIC.len() + SALT_LEN + NONCE_LEN;
        if ciphertext.len() <= header_len || &ciphertext[..MAGIC.len()] != MAGIC {
            return Err("invalid Calen stock backup payload".to_string());
        }
        let salt_start = MAGIC.len();
        let nonce_start = salt_start + SALT_LEN;
        let body_start = nonce_start + NONCE_LEN;
        let salt = &ciphertext[salt_start..nonce_start];
        let nonce = &ciphertext[nonce_start..body_start];
        let body = &ciphertext[body_start..];
        let mut key = Self::derive_key(password, salt)?;
        let cipher = XChaCha20Poly1305::new_from_slice(&key);
        key.zeroize();
        let cipher = cipher.map_err(|error| format!("initialize stock backup cipher: {error}"))?;
        let plaintext = cipher
            .decrypt(XNonce::from_slice(nonce), body)
            .map_err(|_| "stock backup password is incorrect or the file is damaged".to_string());
        plaintext
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn authenticated_backup_cipher_round_trips_and_rejects_wrong_password() {
        let cipher = CalenBackupCipher;
        let encrypted = cipher
            .encrypt(b"portfolio-ledger", "correct horse battery staple")
            .unwrap();
        assert_ne!(encrypted, b"portfolio-ledger");
        assert_eq!(
            cipher
                .decrypt(&encrypted, "correct horse battery staple")
                .unwrap(),
            b"portfolio-ledger"
        );
        assert!(cipher.decrypt(&encrypted, "wrong password").is_err());
    }
}
