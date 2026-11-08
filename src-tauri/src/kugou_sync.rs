//! Automatically enable a temporary KuGou clock for the selected music source.
//! A normal instance exits through Windows Restart Manager before relaunching.
use crate::{audio_source::Source, AppState};
use serde::Serialize;
use std::{
    collections::HashSet,
    mem::size_of,
    os::windows::ffi::OsStrExt,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{atomic::Ordering, Arc, Mutex, OnceLock},
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use windows_sys::Win32::{
    Foundation::{CloseHandle, LocalFree, FILETIME, INVALID_HANDLE_VALUE, WAIT_OBJECT_0},
    NetworkManagement::IpHelper::{
        GetExtendedTcpTable, MIB_TCPTABLE_OWNER_PID, TCP_TABLE_OWNER_PID_LISTENER,
    },
    Networking::WinSock::AF_INET,
    System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
        TH32CS_SNAPPROCESS,
    },
    System::RestartManager::{
        RmEndSession, RmRegisterResources, RmShutdown, RmStartSession, CCH_RM_SESSION_KEY,
        RM_UNIQUE_PROCESS,
    },
    System::Threading::{
        GetProcessTimes, OpenProcess, QueryFullProcessImageNameW, WaitForSingleObject,
        PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_SYNCHRONIZE,
    },
    UI::Shell::CommandLineToArgvW,
};

pub(crate) const PORT: u16 = 9225;
static LAUNCH: Mutex<()> = Mutex::new(());
static STATUS: OnceLock<Mutex<(SyncStatus, u64)>> = OnceLock::new();

#[derive(Clone, Default, Serialize)]
pub struct SyncStatus {
    pub phase: &'static str,
    pub message: String,
}
fn timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
fn state() -> &'static Mutex<(SyncStatus, u64)> {
    STATUS.get_or_init(|| {
        Mutex::new((
            SyncStatus {
                phase: "idle",
                message: String::new(),
            },
            0,
        ))
    })
}
pub(crate) fn report(phase: &'static str, message: &str) -> SyncStatus {
    let status = SyncStatus {
        phase,
        message: message.into(),
    };
    *state().lock().unwrap() = (status.clone(), timestamp());
    status
}
pub(crate) fn status() -> SyncStatus {
    let (status, at) = state().lock().unwrap().clone();
    if status.phase == "ready" && timestamp().saturating_sub(at) > 6000 {
        SyncStatus {
            phase: "connecting",
            message: "增强同步正在重新连接，暂时使用兼容进度。".into(),
        }
    } else {
        status
    }
}
pub(crate) fn transitioning() -> bool {
    if LAUNCH.try_lock().is_err() {
        return true;
    }
    let current = state().lock().unwrap();
    current.0.phase == "starting" && timestamp().saturating_sub(current.1) < 2500
}

// A port number alone does not establish which local program owns the endpoint.
pub(crate) fn listener() -> Result<Option<(u32, bool)>, String> {
    unsafe {
        let mut size = 0;
        GetExtendedTcpTable(
            std::ptr::null_mut(),
            &mut size,
            0,
            AF_INET as u32,
            TCP_TABLE_OWNER_PID_LISTENER,
            0,
        );
        for _ in 0..3 {
            if size < 4 || size > 1_048_576 {
                return Err("无法核对本地同步端口。".into());
            }
            let mut buffer = vec![0usize; (size as usize).div_ceil(size_of::<usize>())];
            let capacity = buffer.len() * size_of::<usize>();
            let result = GetExtendedTcpTable(
                buffer.as_mut_ptr().cast(),
                &mut size,
                0,
                AF_INET as u32,
                TCP_TABLE_OWNER_PID_LISTENER,
                0,
            );
            if result == 122 {
                continue;
            }
            if result != 0 {
                return Err("无法核对本地同步端口。".into());
            }
            let table = &*buffer.as_ptr().cast::<MIB_TCPTABLE_OWNER_PID>();
            let count = table.dwNumEntries as usize;
            let row_size =
                size_of::<windows_sys::Win32::NetworkManagement::IpHelper::MIB_TCPROW_OWNER_PID>();
            if count > capacity.saturating_sub(4) / row_size {
                return Err("本地端口信息无效。".into());
            }
            for row in std::slice::from_raw_parts(table.table.as_ptr(), count) {
                if u16::from_be(row.dwLocalPort as u16) == PORT {
                    return Ok(Some((
                        row.dwOwningPid,
                        row.dwLocalAddr == u32::from_ne_bytes([127, 0, 0, 1]),
                    )));
                }
            }
            return Ok(None);
        }
        Err("本地端口正在变化，请稍后重试。".into())
    }
}

fn main_pid() -> Result<Option<u32>, String> {
    unsafe {
        let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if snapshot == INVALID_HANDLE_VALUE {
            return Err("暂时无法检查酷狗是否运行。".into());
        }
        let mut entry: PROCESSENTRY32W = std::mem::zeroed();
        entry.dwSize = size_of::<PROCESSENTRY32W>() as u32;
        let mut processes = Vec::new();
        let mut more = Process32FirstW(snapshot, &mut entry) != 0;
        if !more {
            CloseHandle(snapshot);
            return Err("暂时无法检查酷狗是否运行。".into());
        }
        while more {
            let end = entry
                .szExeFile
                .iter()
                .position(|c| *c == 0)
                .unwrap_or(entry.szExeFile.len());
            if String::from_utf16_lossy(&entry.szExeFile[..end]).eq_ignore_ascii_case("KuGou.exe") {
                processes.push((entry.th32ProcessID, entry.th32ParentProcessID));
            }
            more = Process32NextW(snapshot, &mut entry) != 0;
        }
        CloseHandle(snapshot);
        let roots: Vec<_> = processes
            .iter()
            .filter(|(_, parent)| !processes.iter().any(|(pid, _)| pid == parent))
            .collect();
        match roots.as_slice() {
            [] if processes.is_empty() => Ok(None),
            [root] => Ok(Some(root.0)),
            _ => Err("检测到多个酷狗进程，请先从托盘完全退出酷狗，再重新选择酷狗音源。".into()),
        }
    }
}

fn executable_from_command(command: &str) -> Option<PathBuf> {
    let wide: Vec<u16> = std::ffi::OsStr::new(command)
        .encode_wide()
        .chain(Some(0))
        .collect();
    unsafe {
        let mut count = 0;
        let args = CommandLineToArgvW(wide.as_ptr(), &mut count);
        if args.is_null() {
            return None;
        }
        let path = if count > 0 {
            let first = *args;
            let mut len = 0;
            while *first.add(len) != 0 && len < 32768 {
                len += 1;
            }
            Some(PathBuf::from(String::from_utf16_lossy(
                std::slice::from_raw_parts(first, len),
            )))
        } else {
            None
        };
        LocalFree(args.cast());
        path.filter(|p| valid_executable(p))
    }
}
fn valid_executable(path: &Path) -> bool {
    path.is_absolute()
        && path.is_file()
        && path
            .file_name()
            .is_some_and(|n| n.eq_ignore_ascii_case("KuGou.exe"))
}
fn installed_executable() -> Result<PathBuf, String> {
    if let Some(path) = windows_registry::CLASSES_ROOT
        .open(r"kugou\shell\open\command")
        .ok()
        .and_then(|key| key.get_string("").ok())
        .and_then(|value| executable_from_command(&value))
    {
        return Ok(path);
    }
    for variable in ["ProgramFiles(x86)", "ProgramFiles", "LOCALAPPDATA"] {
        if let Some(base) = std::env::var_os(variable) {
            for relative in ["KuGou2012/KuGou.exe", "KuGou/KuGou.exe"] {
                let path = PathBuf::from(&base).join(relative);
                if valid_executable(&path) {
                    return Ok(path);
                }
            }
        }
    }
    Err("未找到已安装的酷狗音乐。请先安装并正常启动一次酷狗，再重试。".into())
}

#[derive(Clone, Debug)]
struct Playback {
    title: String,
    artist: String,
    playing: bool,
}
fn media<T>(
    read: impl FnOnce(&windows::Media::Control::GlobalSystemMediaTransportControlsSession) -> Option<T>,
) -> Option<T> {
    use windows::Media::Control::GlobalSystemMediaTransportControlsSessionManager as Manager;
    #[link(name = "runtimeobject")]
    extern "system" {
        fn RoInitialize(kind: u32) -> i32;
        fn RoUninitialize();
    }
    if unsafe { RoInitialize(1) } < 0 {
        return None;
    }
    struct Apartment;
    impl Drop for Apartment {
        fn drop(&mut self) {
            unsafe {
                RoUninitialize();
            }
        }
    }
    let _apartment = Apartment;
    let manager = Manager::RequestAsync().ok()?.join().ok()?;
    let sessions = manager.GetSessions().ok()?;
    let mut selected = Vec::new();
    for i in 0..sessions.Size().ok()? {
        let session = sessions.GetAt(i).ok()?;
        if session
            .SourceAppUserModelId()
            .ok()?
            .to_string()
            .to_ascii_lowercase()
            .contains("kugou")
        {
            selected.push(session);
        }
    }
    if selected.len() != 1 {
        return None;
    }
    read(&selected[0])
}
fn playback() -> Option<Playback> {
    media(|session| {
        let properties = session.TryGetMediaPropertiesAsync().ok()?.join().ok()?;
        Some(Playback {
            title: properties.Title().ok()?.to_string(),
            artist: properties.Artist().ok()?.to_string(),
            playing: session.GetPlaybackInfo().ok()?.PlaybackStatus().ok()?.0 == 4,
        })
    })
    .filter(|p| !p.title.is_empty() && !p.artist.is_empty())
}
fn same_song(before: &Playback, after: &Playback) -> bool {
    before.title == after.title && before.artist == after.artist
}
fn resume(before: &Playback, pid: u32) {
    // Resume only what was already playing before our own restart. Leave the
    // client's restored queue/position intact, and submit Play at most once.
    for _ in 0..40 {
        thread::sleep(Duration::from_millis(200));
        if listener().ok().flatten() != Some((pid, true)) {
            continue;
        }
        let Some(current) = playback() else {
            continue;
        };
        if !same_song(before, &current) || current.playing {
            return;
        }
        let attempted = media(|session| {
            let properties = session.TryGetMediaPropertiesAsync().ok()?.join().ok()?;
            if properties.Title().ok()?.to_string() != before.title
                || properties.Artist().ok()?.to_string() != before.artist
            {
                return Some(());
            }
            if !session
                .GetPlaybackInfo()
                .ok()?
                .Controls()
                .ok()?
                .IsPlayEnabled()
                .ok()?
            {
                return None;
            }
            let _ = session.TryPlayAsync().ok()?.join();
            Some(())
        });
        if attempted.is_some() {
            return;
        }
    }
}

fn restart(pid: u32, executable: &Path) -> Result<(), String> {
    unsafe {
        let process = OpenProcess(
            PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_SYNCHRONIZE,
            0,
            pid,
        );
        if process.is_null() {
            return Err("无法读取酷狗进程，暂时使用兼容同步。".into());
        }
        struct Handle(windows_sys::Win32::Foundation::HANDLE);
        impl Drop for Handle {
            fn drop(&mut self) {
                unsafe {
                    CloseHandle(self.0);
                }
            }
        }
        let _handle = Handle(process);
        let mut image = vec![0u16; 32768];
        let mut len = image.len() as u32;
        if QueryFullProcessImageNameW(process, 0, image.as_mut_ptr(), &mut len) == 0 {
            return Err("无法核对酷狗进程路径。".into());
        }
        let image = PathBuf::from(String::from_utf16_lossy(&image[..len as usize]));
        let root = executable
            .parent()
            .ok_or("酷狗安装目录无效。")?
            .to_string_lossy()
            .replace('/', "\\")
            .to_lowercase();
        if !valid_executable(&image)
            || !image
                .to_string_lossy()
                .replace('/', "\\")
                .to_lowercase()
                .starts_with(&format!("{root}\\"))
        {
            return Err("运行中的酷狗与安装信息不一致，暂时使用兼容同步。".into());
        }
        let mut created = FILETIME::default();
        let mut exited = FILETIME::default();
        let mut kernel = FILETIME::default();
        let mut user = FILETIME::default();
        if GetProcessTimes(process, &mut created, &mut exited, &mut kernel, &mut user) == 0 {
            return Err("无法核对酷狗进程身份。".into());
        }
        let mut session = 0;
        let mut key = [0u16; CCH_RM_SESSION_KEY as usize + 1];
        if RmStartSession(&mut session, 0, key.as_mut_ptr()) != 0 {
            return Err("暂时无法重启酷狗，已保留兼容同步。".into());
        }
        struct Session(u32);
        impl Drop for Session {
            fn drop(&mut self) {
                unsafe {
                    RmEndSession(self.0);
                }
            }
        }
        let _session = Session(session);
        let app = RM_UNIQUE_PROCESS {
            dwProcessId: pid,
            ProcessStartTime: created,
        };
        if RmRegisterResources(session, 0, std::ptr::null(), 1, &app, 0, std::ptr::null()) != 0 {
            return Err("暂时无法重启酷狗，已保留兼容同步。".into());
        }
        report("restarting", "正在重启酷狗以启用实时歌词同步…");
        // Register only this exact process, no files/services. No force flag: the
        // client receives a normal shutdown opportunity to save its own state.
        if RmShutdown(session, 0, None) != 0 || WaitForSingleObject(process, 5000) != WAIT_OBJECT_0
        {
            return Err("酷狗未能正常退出，暂时使用兼容同步；切换音源后可重试。".into());
        }
        for _ in 0..25 {
            if main_pid()?.is_none() {
                return Ok(());
            }
            thread::sleep(Duration::from_millis(100));
        }
        Err("酷狗仍在退出，暂时使用兼容同步；切换音源后可重试。".into())
    }
}

fn ensure() -> Result<SyncStatus, String> {
    let _launch = LAUNCH.try_lock().map_err(|_| "正在启动酷狗，请稍候。")?;
    let owner = listener()?;
    let mut restore = None;
    if let Some(pid) = main_pid()? {
        if owner == Some((pid, true)) {
            return Ok(report(
                "connecting",
                "酷狗已启用增强同步，正在核对当前歌曲和进度。",
            ));
        }
        if owner.is_some() {
            return Err("本地同步端口被其他程序占用，暂时使用兼容同步。".into());
        }
        let executable = installed_executable()?;
        restore = playback().filter(|p| p.playing);
        restart(pid, &executable)?;
    }
    if owner.is_some() {
        return Err("本地同步端口被其他程序占用，请关闭占用程序后重试。".into());
    }
    let executable = installed_executable()?;
    let child = Command::new(&executable)
        .arg(format!("--remote_debug_port={PORT}"))
        .arg("--remote-debugging-address=127.0.0.1")
        .current_dir(executable.parent().ok_or("酷狗安装路径无效。")?)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| "酷狗启动失败，请检查安装是否完整。")?;
    let status = report("starting", "酷狗已启动，正在连接增强同步。");
    if let Some(before) = restore {
        resume(&before, child.id());
    }
    Ok(status)
}

#[derive(Default)]
struct Attempts {
    revision: Option<u64>,
    pids: HashSet<u32>,
    seen: bool,
}
impl Attempts {
    fn take(&mut self, revision: u64, pid: Option<u32>, manual: bool) -> bool {
        if self.revision != Some(revision) {
            *self = Self {
                revision: Some(revision),
                ..Default::default()
            };
        }
        if let Some(pid) = pid {
            self.seen = true;
            self.pids.insert(pid)
        } else if manual && !self.seen {
            self.seen = true;
            true
        } else {
            false
        }
    }
}
pub(crate) fn start(state: Arc<AppState>) {
    thread::spawn(move || {
        let mut attempts = Attempts::default();
        while !state.shutdown.load(Ordering::Relaxed) {
            let source = state.audio_source.lock().unwrap().clone();
            let manual = matches!(&source.selection,Source::Player { id } if id=="kugou");
            let pid = state.status.lock().unwrap().process_id;
            let detected = matches!(source.selection, Source::Auto)
                && state
                    .audio_discovery
                    .lock()
                    .unwrap()
                    .targets
                    .iter()
                    .any(|target| {
                        Some(target.pid) == pid && target.player_id.as_deref() == Some("kugou")
                    });
            if source.error.is_none() && (manual || detected) {
                match main_pid() {
                    Ok(pid) if attempts.take(source.revision, pid, manual) => {
                        if let Err(error) = ensure() {
                            report("unavailable", &error);
                        }
                    }
                    Err(error) => {
                        report("unavailable", &error);
                    }
                    _ => (),
                }
            } else {
                // Selection changes allow an explicit retry; a client closed by
                // its user stays closed until they select it again.
                attempts.take(source.revision, None, false);
            }
            for _ in 0..5 {
                if state.shutdown.load(Ordering::Relaxed) {
                    break;
                }
                thread::sleep(Duration::from_millis(100));
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn retries_only_for_a_new_process_or_explicit_source_change() {
        let mut attempts = Attempts::default();
        assert!(attempts.take(0, Some(10), false));
        assert!(!attempts.take(0, Some(10), false));
        assert!(
            !attempts.take(0, None, true),
            "closing the player must not relaunch it"
        );
        assert!(attempts.take(0, Some(20), false));
        assert!(
            attempts.take(1, None, true),
            "manual selection can start a closed player"
        );
        assert!(!attempts.take(1, None, true));
        assert!(attempts.take(1, Some(20), true));
        assert!(!attempts.take(1, Some(20), true));
    }
    #[test]
    fn resumes_only_the_same_restored_song() {
        let before = Playback {
            title: "歌曲".into(),
            artist: "歌手".into(),
            playing: true,
        };
        let mut after = before.clone();
        after.playing = false;
        assert!(same_song(&before, &after));
        after.title = "另一首".into();
        assert!(!same_song(&before, &after));
        after.title = before.title.clone();
        after.artist = "另一位".into();
        assert!(!same_song(&before, &after));
    }
    #[test]
    #[ignore = "Only reads the installed client registration and process/port ownership"]
    fn installed_client_launch_preflight_read_only() {
        let path = installed_executable().unwrap();
        assert!(valid_executable(&path));
        let pid = main_pid().unwrap().expect("open KuGou manually first");
        assert_eq!(
            listener().unwrap(),
            Some((pid, true)),
            "start with temporary debug parameters first"
        );
        eprintln!("Verified installed KuGou path and loopback listener owned by PID {pid}");
    }
    #[test]
    #[ignore = "Explicitly restarts the installed KuGou to verify ordinary-to-enhanced migration"]
    fn installed_client_automatic_restart() {
        assert_eq!(
            std::env::var("SOUNDSPECTRA_TEST_KUGOU_RESTART").as_deref(),
            Ok("1")
        );
        let executable = installed_executable().unwrap();
        if let Some(pid) = main_pid().unwrap() {
            // Prepare the ordinary-launch case without modifying its shortcut.
            restart(pid, &executable).unwrap();
        }
        Command::new(&executable)
            .current_dir(executable.parent().unwrap())
            .spawn()
            .unwrap();
        thread::sleep(Duration::from_secs(4));
        let ordinary = main_pid().unwrap().unwrap();
        assert_eq!(listener().unwrap(), None);
        ensure().unwrap();
        for _ in 0..60 {
            thread::sleep(Duration::from_millis(200));
            if let Some(pid) = main_pid().unwrap() {
                if pid != ordinary && listener().unwrap() == Some((pid, true)) {
                    ensure().unwrap();
                    assert_eq!(
                        main_pid().unwrap(),
                        Some(pid),
                        "an enhanced client must never restart again"
                    );
                    eprintln!("Verified automatic normal-to-enhanced restart: PID {ordinary} -> {pid}; repeated ensure reused PID {pid}");
                    return;
                }
            }
        }
        panic!("KuGou did not reopen with its loopback sync interface");
    }
}
