//! NetEase's process-local tray commands, independent of SMTC. Never sends
//! global media keys or WM_APPCOMMAND (which Windows can forward to the shell).
use super::{netease::Clock, NowPlaying};
use crate::{
    audio_source::Target,
    card_controls::{MediaAction, MediaCapabilities},
};
use std::{
    thread,
    time::{Duration, Instant},
};
use windows_sys::Win32::{
    Foundation::{CloseHandle, HANDLE, HWND, LPARAM},
    System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_QUERY_LIMITED_INFORMATION,
    },
    UI::WindowsAndMessaging::{
        EnumWindows, GetClassNameW, GetWindowThreadProcessId, IsWindow, SendMessageTimeoutW,
        SMTO_ABORTIFHUNG, SMTO_BLOCK, WM_COMMAND,
    },
};

fn session_id(pid: u32) -> String {
    format!("netease-window:{pid}")
}

struct PlayerWindow {
    hwnd: HWND,
    process: HANDLE,
    pid: u32,
}
impl Drop for PlayerWindow {
    fn drop(&mut self) {
        unsafe {
            CloseHandle(self.process);
        }
    }
}
struct Search {
    pid: u32,
    windows: Vec<HWND>,
}
unsafe extern "system" fn visit(hwnd: HWND, data: LPARAM) -> i32 {
    let search = &mut *(data as *mut Search);
    let mut pid = 0;
    GetWindowThreadProcessId(hwnd, &mut pid);
    if pid == search.pid {
        let mut class = [0u16; 64];
        let len = GetClassNameW(hwnd, class.as_mut_ptr(), class.len() as i32);
        if len > 0 && String::from_utf16_lossy(&class[..len as usize]) == "icon" {
            search.windows.push(hwnd);
        }
    }
    1
}
impl PlayerWindow {
    fn find(target: &Target) -> Option<Self> {
        if target.player_id.as_deref() != Some("netease")
            || !target.executable.eq_ignore_ascii_case("cloudmusic.exe")
        {
            return None;
        }
        unsafe {
            let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, target.pid);
            if process.is_null() {
                return None;
            }
            let mut result = Self {
                hwnd: std::ptr::null_mut(),
                process,
                pid: target.pid,
            };
            let mut path = [0u16; 32768];
            let mut len = path.len() as u32;
            if QueryFullProcessImageNameW(process, 0, path.as_mut_ptr(), &mut len) == 0
                || !String::from_utf16_lossy(&path[..len as usize])
                    .rsplit('\\')
                    .next()?
                    .eq_ignore_ascii_case("cloudmusic.exe")
            {
                return None;
            }
            let mut search = Search {
                pid: target.pid,
                windows: Vec::new(),
            };
            if EnumWindows(Some(visit), &mut search as *mut _ as LPARAM) == 0
                || search.windows.len() != 1
            {
                return None;
            }
            result.hwnd = search.windows[0];
            Some(result)
        }
    }
    fn valid(&self) -> bool {
        let mut pid = 0;
        unsafe {
            IsWindow(self.hwnd) != 0
                && GetWindowThreadProcessId(self.hwnd, &mut pid) != 0
                && pid == self.pid
        }
    }
}

pub(crate) fn attach(target: &Target, info: &mut NowPlaying) {
    if target.player_id.as_deref() != Some("netease")
        || info.timeline_source != Some("netease-events")
        || !info.playback_available
        || info.issue.is_some()
        || info.track_id.is_empty()
        || info.controls.previous
        || info.controls.next
        || info.controls.play
        || info.controls.pause
        || PlayerWindow::find(target).is_none()
    {
        return;
    }
    info.session_id = session_id(target.pid);
    info.controls = MediaCapabilities {
        previous: true,
        next: true,
        play: !info.playing,
        pause: info.playing,
    };
}

pub(crate) fn matches_session(id: &str, pid: u32) -> bool {
    id == session_id(pid)
}

fn command(action: MediaAction, playing: bool) -> Option<usize> {
    // NetEase's tray window accepts WM_COMMAND: HIWORD=0x1800,
    // LOWORD=0 previous, 1 toggle, 2 next. No global fallback.
    let slot = match action {
        MediaAction::Previous => 0,
        MediaAction::Next => 2,
        MediaAction::Play if !playing => 1,
        MediaAction::Pause if playing => 1,
        _ => return None,
    };
    Some((0x1800 << 16) | slot)
}
fn same_instance(current: &NowPlaying, native: &NowPlaying) -> bool {
    native.timeline_source == Some("netease-events")
        && !native.track_id.is_empty()
        && current.track_id.ends_with(&native.track_id)
}
fn acknowledged(action: MediaAction, before: &NowPlaying, after: &NowPlaying) -> bool {
    match action {
        MediaAction::Previous | MediaAction::Next => before.track_id != after.track_id,
        MediaAction::Play => before.track_id == after.track_id && after.playing,
        MediaAction::Pause => before.track_id == after.track_id && !after.playing,
    }
}

pub(crate) struct Command {
    window: PlayerWindow,
    target: Target,
    clock: Clock,
    before: NowPlaying,
    action: MediaAction,
    parameter: Option<usize>,
}
impl Command {
    pub(crate) fn prepare(
        target: &Target,
        current: &NowPlaying,
        action: MediaAction,
    ) -> Result<Self, String> {
        if !matches_session(&current.session_id, target.pid) {
            return Err("播放器会话已变化".into());
        }
        let window = PlayerWindow::find(target).ok_or("网易云控制窗口暂不可用")?;
        let mut clock = Clock::default();
        let before = clock
            .control_snapshot(target)
            .ok_or("正在等待网易云确认播放状态")?;
        if !same_instance(current, &before) {
            return Err("歌曲正在切换，请稍后重试".into());
        }
        let parameter = command(action, before.playing);
        Ok(Self {
            window,
            target: target.clone(),
            clock,
            before,
            action,
            parameter,
        })
    }
    pub(crate) fn send(&self) -> Result<(), String> {
        if !self.window.valid() {
            return Err("网易云已退出，请稍后重试".into());
        }
        let Some(parameter) = self.parameter else {
            return Ok(());
        };
        let mut result = 0;
        let sent = unsafe {
            SendMessageTimeoutW(
                self.window.hwnd,
                WM_COMMAND,
                parameter,
                0,
                SMTO_ABORTIFHUNG | SMTO_BLOCK,
                700,
                &mut result,
            )
        };
        if sent == 0 {
            Err("网易云未响应，请稍后重试".into())
        } else {
            Ok(())
        }
    }
    pub(crate) fn confirm(mut self) -> Result<(), String> {
        if self.parameter.is_none() {
            return Ok(());
        }
        let started = Instant::now();
        while started.elapsed() < Duration::from_millis(1800) && self.window.valid() {
            if self
                .clock
                .control_snapshot(&self.target)
                .is_some_and(|after| acknowledged(self.action, &self.before, &after))
            {
                return Ok(());
            }
            thread::sleep(Duration::from_millis(60));
        }
        // Delivery does not prove acceptance. Never retry a toggle/skip.
        Err("已发送操作，暂未收到网易云状态确认".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn commands_are_local_and_explicit_play_pause_never_toggle_twice() {
        assert_eq!(command(MediaAction::Previous, true), Some(0x18000000));
        assert_eq!(command(MediaAction::Next, false), Some(0x18000002));
        assert_eq!(command(MediaAction::Pause, true), Some(0x18000001));
        assert_eq!(command(MediaAction::Play, false), Some(0x18000001));
        assert_eq!(command(MediaAction::Pause, false), None);
        assert_eq!(command(MediaAction::Play, true), None);
        assert!(matches_session("netease-window:42", 42));
        assert!(!matches_session("netease-window:43", 42));
        assert!(!matches_session("QQMusic.exe", 42));
    }
    #[test]
    fn native_instance_and_response_must_match_the_requested_operation() {
        let before = NowPlaying {
            track_id: ":netease:123:123_ABC".into(),
            timeline_source: Some("netease-events"),
            playing: true,
            ..Default::default()
        };
        let current = NowPlaying {
            track_id: format!("3:uia:42{}", before.track_id),
            ..Default::default()
        };
        assert!(same_instance(&current, &before));
        let paused = NowPlaying {
            playing: false,
            ..before.clone()
        };
        let next = NowPlaying {
            track_id: ":netease:123:123_DEF".into(),
            ..before.clone()
        };
        assert!(!same_instance(&current, &next));
        assert!(!acknowledged(MediaAction::Next, &before, &before));
        assert!(acknowledged(MediaAction::Next, &before, &next));
        assert!(acknowledged(MediaAction::Pause, &before, &paused));
        assert!(!acknowledged(MediaAction::Pause, &before, &next));
        assert!(!acknowledged(MediaAction::Play, &before, &paused));
    }
    #[test]
    #[ignore = "Reads the installed NetEase window and native clock; sends no messages"]
    fn installed_transport_read_only() {
        let pid = std::env::var("SOUNDSPECTRA_TEST_NETEASE_PID")
            .unwrap()
            .parse()
            .unwrap();
        let target = Target {
            pid,
            executable: "cloudmusic.exe".into(),
            name: "网易云音乐".into(),
            player_id: Some("netease".into()),
            audible: true,
        };
        let window = PlayerWindow::find(&target).expect("unique local NetEase tray window");
        assert!(window.valid());
        let mut clock = Clock::default();
        let mut current = clock
            .control_snapshot(&target)
            .expect("native playback instance");
        current.process_id = Some(pid);
        current.track_id = format!("3:{}", current.track_id);
        attach(&target, &mut current);
        assert!(current.controls.next && current.controls.previous);
        Command::prepare(&target, &current, MediaAction::Next).unwrap();
        eprintln!("Verified process-local NetEase control window and current native instance; no command sent");
    }
}
