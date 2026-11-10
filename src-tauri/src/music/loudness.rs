//! Analyze the shared playback buffer on one worker; only measurements reach disk.
use serde::{Deserialize, Serialize};
use std::{
    collections::VecDeque,
    path::Path,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, OnceLock,
    },
};
use symphonia::core::{
    audio::SampleBuffer,
    codecs::DecoderOptions,
    formats::FormatOptions,
    io::{MediaSource, MediaSourceStream},
    meta::MetadataOptions,
    probe::Hint,
};

#[derive(Serialize, Deserialize)]
struct Measurement {
    size: u64,
    checksum: u64,
    lufs: Option<f64>,
}
struct SharedBytes(Arc<Vec<u8>>);
impl AsRef<[u8]> for SharedBytes {
    fn as_ref(&self) -> &[u8] {
        &self.0
    }
}
type Commit = Box<dyn FnOnce(u64, u64, Option<f64>) + Send>;
struct Job {
    bytes: Arc<Vec<u8>>,
    cancelled: Arc<AtomicBool>,
    commit: Commit,
}
struct Worker {
    jobs: VecDeque<Job>,
    running: bool,
}
static WORKER: OnceLock<Mutex<Worker>> = OnceLock::new();
pub fn schedule(bytes: Arc<Vec<u8>>, cancelled: Arc<AtomicBool>, commit: Commit) {
    if cancelled.load(Ordering::Acquire) {
        return;
    }
    let worker = WORKER.get_or_init(|| {
        Mutex::new(Worker {
            jobs: VecDeque::new(),
            running: false,
        })
    });
    let mut w = worker.lock().unwrap();
    // Keep one pending buffer at most. Prefer the newest playback target.
    w.jobs.clear();
    w.jobs.push_back(Job {
        bytes,
        cancelled,
        commit,
    });
    if w.running {
        return;
    }
    w.running = true;
    std::thread::spawn(move || loop {
        let job = {
            let mut w = worker.lock().unwrap();
            match w.jobs.pop_front() {
                Some(j) => j,
                None => {
                    w.running = false;
                    return;
                }
            }
        };
        let Job {
            bytes,
            cancelled,
            commit,
        } = job;
        if cancelled.load(Ordering::Acquire) {
            continue;
        }
        let lufs = analyze(
            Box::new(std::io::Cursor::new(SharedBytes(bytes.clone()))),
            &cancelled,
        );
        if !cancelled.load(Ordering::Acquire) {
            commit(bytes.len() as u64, super::cache::hash(&bytes), lufs);
        }
    });
}
pub fn save(directory: &Path, size: u64, checksum: u64, lufs: Option<f64>) {
    let measurement = Measurement {
        size,
        checksum,
        lufs,
    };
    if let Ok(bytes) = serde_json::to_vec(&measurement) {
        let _ = super::cache::atomic_write(&directory.join("loudness.json"), &bytes);
    }
}
fn analyze(input: Box<dyn MediaSource>, cancelled: &AtomicBool) -> Option<f64> {
    let probed = symphonia::default::get_probe()
        .format(
            &Hint::new(),
            MediaSourceStream::new(input, Default::default()),
            &FormatOptions::default(),
            &MetadataOptions::default(),
        )
        .ok()?;
    let mut format = probed.format;
    let track = format.default_track()?;
    let id = track.id;
    let params = track.codec_params.clone();
    let rate = params.sample_rate?;
    let channels = params.channels?.count();
    if !(8000..=384000).contains(&rate) || channels == 0 || channels > 8 {
        return None;
    }
    let mut decoder = symphonia::default::get_codecs()
        .make(&params, &DecoderOptions::default())
        .ok()?;
    let mut meter = ebur128::EbuR128::new(
        channels as u32,
        rate,
        ebur128::Mode::I | ebur128::Mode::HISTOGRAM,
    )
    .ok()?;
    let mut frames = 0u64;
    loop {
        if cancelled.load(Ordering::Acquire) {
            return None;
        }
        let packet = match format.next_packet() {
            Ok(p) => p,
            Err(symphonia::core::errors::Error::IoError(e))
                if e.kind() == std::io::ErrorKind::UnexpectedEof =>
            {
                break
            }
            Err(_) => return None,
        };
        if packet.track_id() != id {
            continue;
        }
        let decoded = decoder.decode(&packet).ok()?;
        if decoded.capacity() > 65536
            || decoded.spec().channels.count() != channels
            || decoded.spec().rate != rate
        {
            return None;
        }
        let mut samples = SampleBuffer::<f32>::new(decoded.capacity() as u64, *decoded.spec());
        samples.copy_interleaved_ref(decoded);
        meter.add_frames_f32(samples.samples()).ok()?;
        frames += samples.samples().len() as u64 / channels as u64;
        if frames > rate as u64 * 60 * 60 * 4 {
            return None;
        }
    }
    meter.loudness_global().ok().filter(|v| v.is_finite())
}
pub fn attenuation(lufs: f64) -> f64 {
    if !lufs.is_finite() {
        1.0
    } else {
        10f64.powf((-18.0 - lufs).min(0.0) / 20.0)
    }
}
pub fn gain(path: &Path, size: u64, checksum: u64) -> f64 {
    std::fs::read(path.with_file_name("loudness.json"))
        .ok()
        .and_then(|b| serde_json::from_slice::<Measurement>(&b).ok())
        .filter(|m| m.size == size && m.checksum == checksum)
        .and_then(|m| m.lufs)
        .map_or(1.0, attenuation)
}
#[cfg(test)]
pub(super) use tests::test_audio;
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn never_amplifies_or_applies_invalid_results() {
        assert_eq!(attenuation(-25.0), 1.0);
        assert_eq!(attenuation(f64::NAN), 1.0);
        assert!((attenuation(-12.0) - 0.501187).abs() < 0.000001);
    }
    pub fn test_audio() -> Vec<u8> {
        let rate = 48000u32;
        let count = rate * 3;
        let mut bytes = Vec::new();
        bytes.extend(b"RIFF");
        bytes.extend((36 + count * 2).to_le_bytes());
        bytes.extend(b"WAVEfmt ");
        bytes.extend(16u32.to_le_bytes());
        bytes.extend(1u16.to_le_bytes());
        bytes.extend(1u16.to_le_bytes());
        bytes.extend(rate.to_le_bytes());
        bytes.extend((rate * 2).to_le_bytes());
        bytes.extend(2u16.to_le_bytes());
        bytes.extend(16u16.to_le_bytes());
        bytes.extend(b"data");
        bytes.extend((count * 2).to_le_bytes());
        for i in 0..count {
            let s =
                ((i as f64 * std::f64::consts::TAU * 1000.0 / rate as f64).sin() * 16000.0) as i16;
            bytes.extend(s.to_le_bytes());
        }
        bytes
    }
    #[test]
    fn measures_bounded_pcm_packets() {
        let bytes = test_audio();
        let cancelled = AtomicBool::new(false);
        let lufs = analyze(Box::new(std::io::Cursor::new(bytes.clone())), &cancelled).unwrap();
        assert!((-12.0..-7.0).contains(&lufs));
        assert!(attenuation(lufs) < 1.0);
        cancelled.store(true, Ordering::Release);
        assert!(analyze(Box::new(std::io::Cursor::new(bytes)), &cancelled).is_none());
    }
}
