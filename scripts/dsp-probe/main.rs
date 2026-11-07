// Compile the production analyzer directly, without a Tauri window or capture device.
#[allow(dead_code)]
#[path = "../../src-tauri/src/dsp.rs"]
mod dsp;

use serde_json::json;
use std::f64::consts::TAU;

const RATE: usize = 48_000;
const HOP: usize = 1024;

fn source_fingerprint() -> String {
    let hash = include_str!("../../src-tauri/src/dsp.rs")
        .as_bytes()
        .iter()
        .fold(0xcbf29ce484222325u64, |hash, byte| {
            (hash ^ *byte as u64).wrapping_mul(0x100000001b3)
        });
    format!("{hash:016x}")
}

fn main() {
    let mut cases = Vec::new();
    for (name, frequency) in [("bass", 70.3125), ("mid", 996.09375), ("high", 8003.90625)] {
        for rms in [
            0.0001, 0.001, 0.002, 0.004, 0.0059, 0.0061, 0.02, 0.14142136,
        ] {
            cases.push(run(&format!("{name}-{rms}"), 1.2, |i| {
                let v = (TAU * frequency * i as f64 / RATE as f64).sin() * rms * 2f64.sqrt();
                [v, v]
            }));
        }
    }
    for (name, right) in [("stereo", 1.0), ("anti-phase", -1.0), ("left-only", 0.0)] {
        cases.push(run(name, 1.2, |i| {
            let v = (TAU * 996.09375 * i as f64 / RATE as f64).sin() * 0.2;
            [v, v * right]
        }));
    }
    cases.push(run("two-tones", 1.2, |i| {
        let t = i as f64 / RATE as f64;
        let v = ((TAU * 70.3125 * t).sin() + (TAU * 8003.90625 * t).sin()) * 0.14142136;
        [v, v]
    }));
    let mut seed = 0x12345678u32;
    cases.push(run("white-noise", 1.2, |_| {
        seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
        let v = (seed as f64 / u32::MAX as f64 * 2.0 - 1.0) * (0.06f64).sqrt();
        [v, v]
    }));
    cases.push(run("silence", 1.2, |_| [0.0, 0.0]));
    cases.push(run("noise-floor", 1.2, |_| {
        seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
        let v = (seed as f64 / u32::MAX as f64 * 2.0 - 1.0) * 0.0005;
        [v, v]
    }));
    cases.push(run("sustain-vibrato", 3.0, |i| {
        let t = i as f64 / RATE as f64;
        let v = (TAU * 996.09375 * t + 0.6 * (TAU * 5.0 * t).sin()).sin() * 0.12;
        [v, v]
    }));
    cases.push(run("high-over-bass", 2.5, |i| {
        let t = i as f64 / RATE as f64;
        let age = (t - 0.4).rem_euclid(0.5);
        let amp = if t >= 0.4 && age < 0.15 {
            0.025 * (-age / 0.04).exp()
        } else {
            0.0
        };
        let v = (TAU * 70.3125 * t).sin() * 0.2 + (TAU * 8003.90625 * t).sin() * amp;
        [v, v]
    }));
    cases.push(run("same-band-switch", 2.0, |i| {
        let t = i as f64 / RATE as f64;
        let hz = if t < 0.8 { 996.09375 } else { 1406.25 };
        let v = (TAU * hz * t).sin() * 0.2;
        [v, v]
    }));
    cases.push(run("crescendo", 3.0, |i| {
        let t = i as f64 / RATE as f64;
        let v = (TAU * 996.09375 * t).sin() * (0.005 + t * 0.06);
        [v, v]
    }));
    for (name, hz) in [
        ("low-attacks", 70.3125),
        ("mid-attacks", 996.09375),
        ("high-attacks", 8003.90625),
    ] {
        cases.push(run(name, 2.5, |i| {
            let t = i as f64 / RATE as f64;
            let age = (t - 0.4).rem_euclid(0.5);
            let amp = if t >= 0.4 && age < 0.15 {
                0.25 * (-age / 0.04).exp()
            } else {
                0.0
            };
            let v = (TAU * hz * t).sin() * amp;
            [v, v]
        }));
    }
    cases.push(run("weak-gaps", 2.4, |i| {
        let t = i as f64 / RATE as f64;
        let rms = if t < 0.3 || (1.0..1.1).contains(&t) || t >= 1.7 {
            0.0
        } else if t < 0.9 {
            0.004
        } else {
            0.0013
        };
        let v = (TAU * 996.09375 * t).sin() * rms * 2f64.sqrt();
        [v, v]
    }));
    println!(
        "{}",
        serde_json::to_string(&json!({"dspFingerprint":source_fingerprint(), "rate": RATE, "hop": HOP, "cases": cases})).unwrap()
    );
}

fn run(name: &str, seconds: f32, mut sample: impl FnMut(usize) -> [f64; 2]) -> serde_json::Value {
    let mut analyzer = dsp::Analyzer::with_source_revision(1);
    let mut frames = Vec::new();
    let length = (seconds * RATE as f32) as usize;
    for start in (0..length).step_by(HOP) {
        let mut bytes = Vec::with_capacity(HOP * 8);
        for i in start..(start + HOP).min(length) {
            for channel in sample(i) {
                bytes.extend((channel as f32).to_le_bytes());
            }
        }
        let display = analyzer.push_stereo(&bytes);
        for frame in analyzer.take_music_frames() {
            frames.push(json!({"audio": frame, "bars": display}));
        }
    }
    json!({"name": name, "frames": frames})
}
