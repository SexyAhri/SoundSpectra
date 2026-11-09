use crate::audio_source::{player_for, valid_executable, Discovery, Target, PLAYERS};
use std::{
    collections::{HashMap, HashSet},
    mem::size_of,
};
use wasapi::{DeviceEnumerator, Direction};
use windows_sys::Win32::{
    Foundation::{CloseHandle, INVALID_HANDLE_VALUE},
    System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
        TH32CS_SNAPPROCESS,
    },
};

#[derive(Clone)]
struct Process {
    pid: u32,
    parent: u32,
    executable: String,
}

fn processes() -> Result<Vec<Process>, String> {
    unsafe {
        let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if snapshot == INVALID_HANDLE_VALUE {
            return Err("无法读取运行中的应用，请稍后重试。".into());
        }
        let mut entry: PROCESSENTRY32W = std::mem::zeroed();
        entry.dwSize = size_of::<PROCESSENTRY32W>() as u32;
        let mut more = Process32FirstW(snapshot, &mut entry) != 0;
        if !more {
            CloseHandle(snapshot);
            return Err("无法读取应用列表，请稍后重试。".into());
        }
        let mut result = Vec::new();
        while more {
            let end = entry
                .szExeFile
                .iter()
                .position(|c| *c == 0)
                .unwrap_or(entry.szExeFile.len());
            result.push(Process {
                pid: entry.th32ProcessID,
                parent: entry.th32ParentProcessID,
                executable: String::from_utf16_lossy(&entry.szExeFile[..end]),
            });
            more = Process32NextW(snapshot, &mut entry) != 0;
        }
        CloseHandle(snapshot);
        Ok(result)
    }
}

// Session meters are only used to choose a process. Captured PCM still comes
// exclusively from application loopback, never from a device/system mix.
fn session_peaks() -> (HashMap<u32, f32>, Option<String>) {
    let mut peaks = HashMap::<u32, f32>::new();
    let result = (|| {
        let devices = DeviceEnumerator::new()?.get_device_collection(&Direction::Render)?;
        let mut incomplete = false;
        for device in &devices {
            let result = (|| {
                let sessions = device?
                    .get_iaudiosessionmanager()?
                    .get_audiosessionenumerator()?;
                for i in 0..sessions.get_count()? {
                    let control = match sessions.get_session(i) {
                        Ok(value) => value,
                        Err(_) => {
                            incomplete = true;
                            continue;
                        }
                    };
                    if let Ok(pid) = control.get_process_id() {
                        if pid == 0 {
                            continue;
                        }
                        let peak = control
                            .get_audiometerinformation()
                            .and_then(|meter| meter.get_peak_value())
                            .unwrap_or_else(|_| {
                                incomplete = true;
                                0.0
                            });
                        peaks
                            .entry(pid)
                            .and_modify(|old| *old = old.max(peak))
                            .or_insert(peak);
                    } else {
                        incomplete = true;
                    }
                }
                Ok::<_, wasapi::WasapiError>(())
            })();
            if result.is_err() {
                incomplete = true;
            }
        }
        Ok::<_, wasapi::WasapiError>(incomplete)
    })();
    let warning = match result {
        Ok(false) => None,
        _ => Some("部分音频会话无法读取；仍可手动选择客户端，自动切换可能延迟。".into()),
    };
    (peaks, warning)
}

fn ancestors<'a>(process: &'a Process, map: &HashMap<u32, &'a Process>) -> Vec<&'a Process> {
    let mut result = vec![process];
    let mut seen = HashSet::from([process.pid]);
    let mut current = process;
    while result.len() < 64 {
        let Some(parent) = map.get(&current.parent) else {
            break;
        };
        if !seen.insert(parent.pid) {
            break;
        }
        result.push(parent);
        current = parent;
    }
    result
}

fn targets(processes: &[Process], peaks: &HashMap<u32, f32>) -> Vec<Target> {
    let map: HashMap<_, _> = processes.iter().map(|p| (p.pid, p)).collect();
    let mut found = HashMap::<u32, Target>::new();
    for process in processes {
        let chain = ancestors(process, &map);
        // Identify the nearest music client, then its highest same-player root.
        // A different music client used as a launcher must not absorb this one.
        let player_id = chain
            .iter()
            .find_map(|p| player_for(&p.executable).map(|p| p.id));
        let known = player_id.and_then(|id| {
            chain
                .iter()
                .rev()
                .copied()
                .find(|p| player_for(&p.executable).is_some_and(|player| player.id == id))
        });
        let root = if let Some(known) = known {
            known
        } else if peaks.contains_key(&process.pid) {
            chain
                .iter()
                .rev()
                .copied()
                .find(|p| p.executable.eq_ignore_ascii_case(&process.executable))
                .unwrap_or(process)
        } else {
            continue;
        };
        if !valid_executable(&root.executable) || root.pid == std::process::id() {
            continue;
        }
        let player = player_for(&root.executable);
        let target = found.entry(root.pid).or_insert_with(|| Target {
            pid: root.pid,
            executable: root.executable.clone(),
            name: player.map_or_else(|| root.executable.clone(), |player| player.name.into()),
            player_id: player.map(|player| player.id.into()),
            audible: false,
        });
        target.audible |= peaks.get(&process.pid).is_some_and(|peak| *peak > 0.001);
    }
    let mut result: Vec<_> = found.into_values().collect();
    result.sort_by_key(|target| {
        (
            PLAYERS
                .iter()
                .position(|p| Some(p.id) == target.player_id.as_deref())
                .unwrap_or(PLAYERS.len()),
            target.executable.to_lowercase(),
            target.pid,
        )
    });
    result
}

pub fn scan() -> Result<Discovery, String> {
    let processes = processes()?;
    let (peaks, warning) = session_peaks();
    Ok(Discovery {
        targets: targets(&processes, &peaks),
        warning,
    })
}

fn builtin_process<'a>(
    processes: &'a [Process],
    peaks: &HashMap<u32, f32>,
    root: u32,
) -> Option<&'a Process> {
    let map: HashMap<_, _> = processes.iter().map(|p| (p.pid, p)).collect();
    processes
        .iter()
        .filter(|p| peaks.contains_key(&p.pid) && ancestors(p, &map).iter().any(|a| a.pid == root))
        .max_by(|a, b| peaks[&a.pid].total_cmp(&peaks[&b.pid]))
}

/// WebView2 renders through a separate audio service. Target its actual audio
/// session, including when a browser process outlives a hot-reloaded host.
pub fn builtin_target() -> Option<Target> {
    let processes = processes().ok()?;
    let (peaks, _) = session_peaks();
    let process = builtin_process(&processes, &peaks, std::process::id())?;
    Some(Target {
        pid: process.pid,
        executable: process.executable.clone(),
        name: "SoundSpectra · 内置播放".into(),
        player_id: Some("soundspectra".into()),
        audible: peaks[&process.pid] > 0.001,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn process(pid: u32, parent: u32, executable: &str) -> Process {
        Process {
            pid,
            parent,
            executable: executable.into(),
        }
    }
    #[test]
    fn builtin_capture_selects_only_its_own_audio_service() {
        let processes = vec![
            process(10, 1, "soundspectra.exe"),
            process(11, 10, "msedgewebview2.exe"),
            process(12, 11, "msedgewebview2.exe"),
            process(20, 1, "chrome.exe"),
        ];
        let peaks = HashMap::from([(12, 0.1), (20, 0.9)]);
        assert_eq!(builtin_process(&processes, &peaks, 10).unwrap().pid, 12);
        assert!(builtin_process(&processes, &peaks, 30).is_none());
    }
    #[test]
    fn music_children_map_to_music_root_not_explorer_or_other_audio_apps() {
        let processes = vec![
            process(1, 0, "explorer.exe"),
            process(20, 1, "QQMusic.exe"),
            process(21, 20, "QQMusic.exe"),
            process(22, 21, "audio-helper.exe"),
            process(30, 1, "chrome.exe"),
            process(31, 30, "chrome.exe"),
            process(40, 1, "game.exe"),
        ];
        let result = targets(
            &processes,
            &HashMap::from([(22, 0.5), (31, 0.8), (40, 0.9)]),
        );
        let music = result
            .iter()
            .find(|t| t.player_id.as_deref() == Some("qqmusic"))
            .unwrap();
        assert_eq!(music.pid, 20);
        assert!(music.audible);
        assert_eq!(result.iter().filter(|t| t.player_id.is_some()).count(), 1);
        assert!(result.iter().any(|t| t.pid == 30 && t.player_id.is_none()));
        assert!(!result.iter().any(|t| [1, 21, 22, 31].contains(&t.pid)));
    }
    #[test]
    fn launching_another_music_client_keeps_separate_roots() {
        let processes = vec![
            process(10, 0, "QQMusic.exe"),
            process(20, 10, "cloudmusic.exe"),
            process(21, 20, "cloudmusic.exe"),
            process(22, 21, "audio-helper.exe"),
        ];
        let result = targets(&processes, &HashMap::from([(22, 0.5)]));
        assert_eq!(result.len(), 2);
        assert!(result.iter().find(|t| t.pid == 20).unwrap().audible);
        assert!(!result.iter().find(|t| t.pid == 10).unwrap().audible);
    }
    #[test]
    fn mixed_case_names_cycles_and_multiple_instances_are_bounded() {
        let processes = vec![
            process(10, 11, "CLOUDMUSIC.EXE"),
            process(11, 10, "helper.exe"),
            process(20, 999, "cloudmusic.exe"),
        ];
        let result = targets(&processes, &HashMap::from([(11, 0.2)]));
        assert_eq!(result.len(), 2);
        assert!(result.iter().find(|t| t.pid == 10).unwrap().audible);
        assert!(!result.iter().find(|t| t.pid == 20).unwrap().audible);
    }
}
