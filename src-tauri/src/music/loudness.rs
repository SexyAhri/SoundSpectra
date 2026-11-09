//! Complete-file analysis on a single worker; never decodes a whole song to PCM.
use serde::{Deserialize, Serialize};
use std::{
    collections::VecDeque,
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
};
use symphonia::core::{
    audio::SampleBuffer, codecs::DecoderOptions, formats::FormatOptions, io::MediaSourceStream,
    meta::MetadataOptions, probe::Hint,
};

#[derive(Serialize, Deserialize)]
struct Measurement {
    size: u64,
    checksum: u64,
    lufs: Option<f64>,
}
type Job = (PathBuf, u64, u64);
struct Worker {
    jobs: VecDeque<Job>,
    running: bool,
}
static WORKER: OnceLock<Mutex<Worker>> = OnceLock::new();
pub fn schedule(path: PathBuf, size: u64, checksum: u64) {
    if std::fs::read(path.with_file_name("loudness.json"))
        .ok()
        .and_then(|b| serde_json::from_slice::<Measurement>(&b).ok())
        .is_some_and(|m| m.size == size && m.checksum == checksum)
    {
        return;
    }
    let worker = WORKER.get_or_init(|| {
        Mutex::new(Worker {
            jobs: VecDeque::new(),
            running: false,
        })
    });
    let mut w = worker.lock().unwrap();
    if w.jobs.iter().any(|j| j.0 == path) || w.jobs.len() >= 8 {
        return;
    }
    w.jobs.push_back((path, size, checksum));
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
        let (path, size, checksum) = job;
        if !path.metadata().is_ok_and(|m| m.len() == size) {
            continue;
        }
        let lufs = analyze(&path);
        // Never attach a measurement to a replacement file or resurrect cleared data.
        if fingerprint(&path) == Some((size, checksum)) {
            let _ = std::fs::write(
                path.with_file_name("loudness.json"),
                serde_json::to_vec(&Measurement {
                    size,
                    checksum,
                    lufs,
                })
                .unwrap(),
            );
        }
    });
}
fn fingerprint(path: &Path) -> Option<(u64, u64)> {
    use std::io::Read;
    let mut file = std::fs::File::open(path).ok()?;
    let mut size = 0u64;
    let mut hash = 0xcbf29ce484222325u64;
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let n = file.read(&mut buffer).ok()?;
        if n == 0 {
            break;
        }
        size += n as u64;
        for b in &buffer[..n] {
            hash = (hash ^ *b as u64).wrapping_mul(0x100000001b3);
        }
    }
    Some((size, hash))
}
fn analyze(path: &Path) -> Option<f64> {
    let input = std::fs::File::open(path).ok()?;
    let probed = symphonia::default::get_probe()
        .format(
            &Hint::new(),
            MediaSourceStream::new(Box::new(input), Default::default()),
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
mod tests {
    use super::*;
    #[test]
    fn never_amplifies_or_applies_invalid_results() {
        assert_eq!(attenuation(-25.0), 1.0);
        assert_eq!(attenuation(f64::NAN), 1.0);
        assert!((attenuation(-12.0) - 0.501187).abs() < 0.000001);
    }
    #[test]
    fn measures_bounded_pcm_packets() {
        let path = std::env::temp_dir().join(format!(
            "music-loudness-{}-{}.wav",
            std::process::id(),
            super::super::now()
        ));
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
        std::fs::write(&path, bytes).unwrap();
        let lufs = analyze(&path).unwrap();
        assert!((-12.0..-7.0).contains(&lufs));
        assert!(attenuation(lufs) < 1.0);
        let _ = std::fs::remove_file(path);
    }
}
