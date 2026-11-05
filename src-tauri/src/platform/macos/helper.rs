use std::{
    fs,
    io::Read,
    os::unix::fs::PermissionsExt,
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::OnceLock,
    time::Duration,
};

static PATH: OnceLock<Result<PathBuf, String>> = OnceLock::new();
pub fn command() -> Result<Command, String> {
    let path = PATH.get_or_init(|| {
        let root = PathBuf::from(std::env::var_os("HOME").ok_or("无法定位用户目录")?)
            .join("Library/Caches/com.soundspectra.desktop/native")
            .join(env!("CARGO_PKG_VERSION"))
            .join(std::env::consts::ARCH);
        fs::create_dir_all(&root).map_err(|e| e.to_string())?;
        fs::set_permissions(&root, fs::Permissions::from_mode(0o700)).map_err(|e| e.to_string())?;
        let path = root.join("soundspectra-native");
        let bytes = include_bytes!(env!("SOUNDSPECTRA_MACOS_HELPER"));
        if fs::read(&path).ok().as_deref() != Some(bytes.as_slice()) {
            let temp = root.join(format!("helper-{}.tmp", std::process::id()));
            fs::write(&temp, bytes).map_err(|e| e.to_string())?;
            fs::set_permissions(&temp, fs::Permissions::from_mode(0o700))
                .map_err(|e| e.to_string())?;
            fs::rename(temp, &path).map_err(|e| e.to_string())?;
        }
        Ok(path)
    });
    Ok(Command::new(path.as_ref().map_err(Clone::clone)?))
}

pub struct ManagedChild(pub Child);
impl Drop for ManagedChild {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}
pub fn json(args: &[&str], timeout: Duration) -> Result<serde_json::Value, String> {
    let mut child = ManagedChild(
        command()?
            .args(args)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| e.to_string())?,
    );
    let stdout = child.0.stdout.take().unwrap();
    let stderr = child.0.stderr.take().unwrap();
    let (tx, rx) = std::sync::mpsc::channel();
    let err = std::thread::spawn(move || {
        let mut bytes = Vec::new();
        let _ = stderr.take(4096).read_to_end(&mut bytes);
        String::from_utf8_lossy(&bytes).into_owned()
    });
    std::thread::spawn(move || {
        let mut bytes = Vec::new();
        let result = stdout
            .take(32 * 1024 * 1024)
            .read_to_end(&mut bytes)
            .map(|_| bytes);
        let _ = tx.send(result);
    });
    let bytes = rx
        .recv_timeout(timeout)
        .map_err(|_| "原生查询超时，请检查播放器授权".to_string())?
        .map_err(|e| e.to_string())?;
    let status = child.0.wait().map_err(|e| e.to_string())?;
    if !status.success() {
        return Err(err.join().unwrap_or_else(|_| "原生查询失败".into()));
    }
    serde_json::from_slice(&bytes).map_err(|_| "播放器未提供可用的歌曲信息".into())
}
