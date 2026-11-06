//! The WebView stays at Explorer's integrity level. A separate, session-scoped
//! process can only read/check and change hidden/system bits on Desktop entries.
use serde::{Deserialize, Serialize};
use std::{
    fs::{File, OpenOptions},
    io::{BufRead, BufReader, Write},
    os::windows::io::{AsRawHandle, FromRawHandle},
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
    time::{Duration, Instant},
};
use windows_sys::Win32::{
    Foundation::*,
    Storage::FileSystem::*,
    System::{Pipes::*, Threading::*},
    UI::Shell::*,
};

#[derive(Serialize, Deserialize)]
struct Request {
    path: PathBuf,
    identity: [u32; 3],
    mask: Option<u32>,
}
struct Session {
    reader: BufReader<File>,
}
struct Broker {
    session: Option<Session>,
    failed: Option<Instant>,
}
static BROKER: OnceLock<Mutex<Broker>> = OnceLock::new();
fn wide(value: &std::ffi::OsStr) -> Vec<u16> {
    use std::os::windows::ffi::OsStrExt;
    value.encode_wide().chain(Some(0)).collect()
}
fn error() -> String {
    std::io::Error::last_os_error().to_string()
}
fn line(reader: &mut BufReader<File>) -> Result<String, String> {
    // Requests are bounded independently of the caller's UI validation.
    let mut bytes = vec![];
    loop {
        let available = reader.fill_buf().map_err(|e| e.to_string())?;
        if available.is_empty() {
            return Err("桌面权限助手已断开".into());
        }
        let count = available
            .iter()
            .position(|b| *b == b'\n')
            .map(|p| p + 1)
            .unwrap_or(available.len());
        if bytes.len() + count > 200_000 {
            return Err("桌面权限请求过长".into());
        }
        let done = available[count - 1] == b'\n';
        bytes.extend_from_slice(&available[..count]);
        reader.consume(count);
        if done {
            return String::from_utf8(bytes).map_err(|e| e.to_string());
        }
    }
}
fn same_program(pid: u32) -> bool {
    unsafe {
        let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if process.is_null() {
            return false;
        }
        let mut buffer = vec![0u16; 32768];
        let mut length = buffer.len() as u32;
        let ok = QueryFullProcessImageNameW(process, 0, buffer.as_mut_ptr(), &mut length) != 0;
        CloseHandle(process);
        ok && std::env::current_exe().is_ok_and(|exe| {
            exe.to_string_lossy()
                .eq_ignore_ascii_case(&String::from_utf16_lossy(&buffer[..length as usize]))
        })
    }
}
impl Session {
    fn start() -> Result<Self, String> {
        let name = format!(
            r"\\.\pipe\SoundSpectra-rail-{}-{}",
            std::process::id(),
            super::model::new_id()
        );
        let pipe_name = wide(std::ffi::OsStr::new(&name));
        unsafe {
            let handle = CreateNamedPipeW(
                pipe_name.as_ptr(),
                PIPE_ACCESS_DUPLEX | FILE_FLAG_FIRST_PIPE_INSTANCE,
                PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_NOWAIT | PIPE_REJECT_REMOTE_CLIENTS,
                1,
                65536,
                65536,
                0,
                std::ptr::null(),
            );
            if handle == INVALID_HANDLE_VALUE {
                return Err(error());
            }
            let file = File::from_raw_handle(handle);
            // Put the nonblocking server into listening state before starting
            // the client, so its first CreateFile cannot race ConnectNamedPipe.
            ConnectNamedPipe(handle, std::ptr::null_mut());
            let executable = wide(
                std::env::current_exe()
                    .map_err(|e| e.to_string())?
                    .as_os_str(),
            );
            let verb = wide(std::ffi::OsStr::new("runas"));
            let args = wide(std::ffi::OsStr::new(&format!(
                "--rail-attribute-helper {} {}",
                std::process::id(),
                name
            )));
            let mut info: SHELLEXECUTEINFOW = std::mem::zeroed();
            info.cbSize = std::mem::size_of_val(&info) as u32;
            info.fMask = SEE_MASK_NOCLOSEPROCESS | SEE_MASK_NOASYNC | SEE_MASK_FLAG_NO_UI;
            info.lpVerb = verb.as_ptr();
            info.lpFile = executable.as_ptr();
            info.lpParameters = args.as_ptr();
            info.nShow = 0;
            if ShellExecuteExW(&mut info) == 0 {
                return Err(format!("未取得桌面项目权限：{}", error()));
            }
            let child = GetProcessId(info.hProcess);
            CloseHandle(info.hProcess);
            let start = Instant::now();
            loop {
                if ConnectNamedPipe(handle, std::ptr::null_mut()) != 0
                    || GetLastError() == ERROR_PIPE_CONNECTED
                {
                    break;
                }
                if start.elapsed() > Duration::from_secs(10) {
                    return Err("桌面权限助手连接超时".into());
                }
                std::thread::sleep(Duration::from_millis(20));
            }
            let mut client = 0;
            if GetNamedPipeClientProcessId(handle, &mut client) == 0 || client != child {
                return Err("桌面权限助手身份不符".into());
            }
            let mode = PIPE_READMODE_BYTE | PIPE_WAIT;
            if SetNamedPipeHandleState(handle, &mode, std::ptr::null(), std::ptr::null()) == 0 {
                return Err(error());
            }
            Ok(Self {
                reader: BufReader::new(file),
            })
        }
    }
    fn request(&mut self, request: &Request) -> Result<Result<(), String>, String> {
        let mut bytes = serde_json::to_vec(request).map_err(|e| e.to_string())?;
        bytes.push(b'\n');
        self.reader
            .get_mut()
            .write_all(&bytes)
            .map_err(|e| e.to_string())?;
        serde_json::from_str(&line(&mut self.reader)?).map_err(|e| e.to_string())
    }
}
pub(super) fn request(path: &Path, mask: Option<u32>) -> Result<(), String> {
    let request = Request {
        path: path.into(),
        identity: super::desktop_visibility::identity(path)?,
        mask,
    };
    let mut broker = BROKER
        .get_or_init(|| {
            Mutex::new(Broker {
                session: None,
                failed: None,
            })
        })
        .lock()
        .map_err(|e| e.to_string())?;
    if broker.session.is_none() {
        if broker
            .failed
            .is_some_and(|at| at.elapsed() < Duration::from_secs(60))
        {
            return Err("桌面权限未授权，请稍后重试".into());
        }
        match Session::start() {
            Ok(session) => broker.session = Some(session),
            Err(e) => {
                broker.failed = Some(Instant::now());
                return Err(e);
            }
        }
    }
    match broker.session.as_mut().unwrap().request(&request) {
        Ok(result) => result,
        Err(e) => {
            broker.session = None;
            broker.failed = Some(Instant::now());
            Err(e)
        }
    }
}
fn apply(request: Request) -> Result<(), String> {
    use std::os::windows::fs::OpenOptionsExt;
    if !request.path.is_absolute()
        || !super::desktop_visibility::is_desktop_item(&request.path)
        || request.mask.is_some_and(|mask| mask & !6 != 0)
    {
        return Err("只允许修改桌面直属项目的隐藏属性".into());
    }
    let file = OpenOptions::new()
        .access_mode(FILE_READ_ATTRIBUTES | FILE_WRITE_ATTRIBUTES)
        .share_mode(7)
        .custom_flags(FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT)
        .open(&request.path)
        .map_err(|e| e.to_string())?;
    if super::desktop_visibility::file_identity(&file)? != request.identity {
        return Err("桌面项目已更换".into());
    }
    if let Some(mask) = request.mask {
        unsafe {
            let mut basic: FILE_BASIC_INFO = std::mem::zeroed();
            if GetFileInformationByHandleEx(
                file.as_raw_handle(),
                FileBasicInfo,
                (&mut basic as *mut FILE_BASIC_INFO).cast(),
                std::mem::size_of_val(&basic) as u32,
            ) == 0
            {
                return Err(error());
            }
            // Zero timestamps mean preserve; no content, ACL, or registry writes.
            let mut next: FILE_BASIC_INFO = std::mem::zeroed();
            next.FileAttributes = (basic.FileAttributes & !(6 | FILE_ATTRIBUTE_NORMAL)) | mask;
            if next.FileAttributes == 0 {
                next.FileAttributes = FILE_ATTRIBUTE_NORMAL;
            }
            if SetFileInformationByHandle(
                file.as_raw_handle(),
                FileBasicInfo,
                (&next as *const FILE_BASIC_INFO).cast(),
                std::mem::size_of_val(&next) as u32,
            ) == 0
            {
                return Err(error());
            }
        }
    }
    Ok(())
}
/// Intercept before Tauri/single-instance setup. EOF exits with the UI process.
pub(crate) fn entry() -> bool {
    let args: Vec<_> = std::env::args().collect();
    if args.get(1).map(String::as_str) != Some("--rail-attribute-helper") {
        return false;
    }
    let _ = (|| -> Result<(), String> {
        let pid: u32 = args
            .get(2)
            .ok_or("缺少进程")?
            .parse()
            .map_err(|_| "进程无效")?;
        let name = args.get(3).ok_or("缺少通道")?;
        if args.len() != 4
            || !name.starts_with(&format!(r"\\.\pipe\SoundSpectra-rail-{pid}-"))
            || !same_program(pid)
        {
            return Err("无效权限请求".into());
        }
        use std::os::windows::fs::OpenOptionsExt;
        // A medium-integrity pipe server must never impersonate this helper.
        let file = OpenOptions::new()
            .read(true)
            .write(true)
            .custom_flags(SECURITY_SQOS_PRESENT | SECURITY_ANONYMOUS)
            .open(name)
            .map_err(|e| e.to_string())?;
        let mut server = 0;
        if unsafe { GetNamedPipeServerProcessId(file.as_raw_handle(), &mut server) } == 0
            || server != pid
        {
            return Err("无效调用进程".into());
        }
        let mut reader = BufReader::new(file);
        while let Ok(message) = line(&mut reader) {
            let result = serde_json::from_str::<Request>(&message)
                .map_err(|e| e.to_string())
                .and_then(apply);
            let mut response = serde_json::to_vec(&result).map_err(|e| e.to_string())?;
            response.push(b'\n');
            reader
                .get_mut()
                .write_all(&response)
                .map_err(|e| e.to_string())?;
        }
        Ok(())
    })();
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_non_desktop_paths_and_unrelated_attribute_bits() {
        let path = std::env::temp_dir().join("never-modify.txt");
        assert!(apply(Request {
            path: path.clone(),
            identity: [0; 3],
            mask: Some(6)
        })
        .is_err());
        assert!(apply(Request {
            path,
            identity: [0; 3],
            mask: Some(1)
        })
        .is_err());
    }
}
