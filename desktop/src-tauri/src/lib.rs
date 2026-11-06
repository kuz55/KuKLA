const KEYRING_UNAVAILABLE: &str = "The operating system credential store is unavailable";

#[cfg(any(target_os = "linux", target_os = "windows"))]
use keyring::{Entry, Error as KeyringError};

#[cfg(any(target_os = "linux", target_os = "windows"))]
const KEYRING_SERVICE: &str = "ru.kukla.desktop";
#[cfg(any(target_os = "linux", target_os = "windows"))]
const KEYRING_USERNAME: &str = "session-token";

#[cfg(any(target_os = "linux", target_os = "windows"))]
fn session_entry() -> Result<Entry, String> {
    Entry::new(KEYRING_SERVICE, KEYRING_USERNAME).map_err(|_| KEYRING_UNAVAILABLE.to_string())
}

#[cfg(any(target_os = "linux", target_os = "windows"))]
#[tauri::command]
fn get_session_token() -> Result<Option<String>, String> {
    match session_entry()?.get_password() {
        Ok(token) => Ok(Some(token)),
        Err(KeyringError::NoEntry) => Ok(None),
        Err(_) => Err(KEYRING_UNAVAILABLE.to_string()),
    }
}

#[cfg(not(any(target_os = "linux", target_os = "windows")))]
#[tauri::command]
fn get_session_token() -> Result<Option<String>, String> {
    Err(KEYRING_UNAVAILABLE.to_string())
}

#[cfg(any(target_os = "linux", target_os = "windows"))]
#[tauri::command]
fn set_session_token(token: String) -> Result<(), String> {
    session_entry()?
        .set_password(&token)
        .map_err(|_| KEYRING_UNAVAILABLE.to_string())
}

#[cfg(not(any(target_os = "linux", target_os = "windows")))]
#[tauri::command]
fn set_session_token(_token: String) -> Result<(), String> {
    Err(KEYRING_UNAVAILABLE.to_string())
}

#[cfg(any(target_os = "linux", target_os = "windows"))]
#[tauri::command]
fn clear_session_token() -> Result<(), String> {
    match session_entry()?.delete_credential() {
        Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
        Err(_) => Err(KEYRING_UNAVAILABLE.to_string()),
    }
}

#[cfg(not(any(target_os = "linux", target_os = "windows")))]
#[tauri::command]
fn clear_session_token() -> Result<(), String> {
    Err(KEYRING_UNAVAILABLE.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            get_session_token,
            set_session_token,
            clear_session_token
        ])
        .run(tauri::generate_context!())
        .expect("error while running KuKLA");
}
