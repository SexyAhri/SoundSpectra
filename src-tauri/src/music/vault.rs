//! The saved session is encrypted for the current Windows user with DPAPI.
//! It is separate from settings, exports, backups and diagnostics.
use std::path::Path;

#[cfg(windows)]
fn protect(bytes: &[u8], decrypt: bool) -> Result<Vec<u8>, String> {
    use windows_sys::Win32::{
        Foundation::LocalFree,
        Security::Cryptography::{
            CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
        },
    };
    let input = CRYPT_INTEGER_BLOB {
        cbData: bytes.len() as u32,
        pbData: bytes.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: std::ptr::null_mut(),
    };
    let ok = unsafe {
        if decrypt {
            CryptUnprotectData(
                &input,
                std::ptr::null_mut(),
                std::ptr::null(),
                std::ptr::null_mut(),
                std::ptr::null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        } else {
            CryptProtectData(
                &input,
                std::ptr::null(),
                std::ptr::null(),
                std::ptr::null_mut(),
                std::ptr::null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        }
    };
    if ok == 0 {
        return Err("无法访问本机加密登录凭据，请重新登录".into());
    }
    let result =
        unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec() };
    unsafe {
        LocalFree(output.pbData as *mut _);
    }
    Ok(result)
}

pub fn read(path: &Path) -> Option<Vec<u8>> {
    #[cfg(windows)]
    {
        protect(&std::fs::read(path).ok()?, true).ok()
    }
    #[cfg(not(windows))]
    {
        let _ = path;
        None
    }
}

pub fn write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    #[cfg(windows)]
    {
        let encrypted = protect(bytes, false)?;
        std::fs::create_dir_all(path.parent().ok_or("凭据目录不存在")?)
            .map_err(|_| "无法创建凭据目录")?;
        let temporary = path.with_extension("tmp");
        std::fs::write(&temporary, encrypted).map_err(|_| "无法保存加密凭据")?;
        std::fs::rename(temporary, path).map_err(|_| "无法更新加密凭据")?;
    }
    #[cfg(not(windows))]
    {
        let _ = (path, bytes);
    }
    Ok(())
}

pub fn remove(path: &Path) -> Result<(), String> {
    match std::fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(_) => Err("无法删除本机登录凭据".into()),
    }
}

#[cfg(all(test, windows))]
mod tests {
    #[test]
    fn session_is_encrypted_and_roundtrips_for_current_user() {
        let secret = b"fixture-session-only";
        let encrypted = super::protect(secret, false).unwrap();
        assert!(!encrypted.windows(secret.len()).any(|part| part == secret));
        assert_eq!(super::protect(&encrypted, true).unwrap(), secret);
        assert!(super::protect(b"invalid ciphertext", true).is_err());
    }
}
