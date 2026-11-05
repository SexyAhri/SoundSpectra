use rustfft::{num_complex::Complex, Fft, FftPlanner};
use std::{collections::VecDeque, sync::Arc};

pub const BANDS: usize = 96;
const SIZE: usize = 4096;
const HOP: usize = 1024;
const RATE: f32 = 48_000.0;

#[derive(Clone, Default, serde::Serialize)]
pub struct MusicAnalysis {
    pub rms: f32,
    pub bands: Vec<f32>,
    pub spectrum: Vec<f32>,
    pub skin: Vec<u8>,
}

// Integrate interpolated bin power over each logarithmic band. Narrow bass
// bands keep their fractional boundaries instead of sharing one maximum bin.
fn band_magnitude(magnitudes: &[f32], low: f32, high: f32) -> f32 {
    let mut position = low;
    let mut power = 0.0;
    while position < high {
        let index = position.floor() as usize;
        let end = high.min(index as f32 + 1.0);
        let left = magnitudes[index].powi(2);
        let right = magnitudes[(index + 1).min(magnitudes.len() - 1)].powi(2);
        let start_power = left + (right - left) * (position - index as f32);
        let end_power = left + (right - left) * (end - index as f32);
        power += (start_power + end_power) * 0.5 * (end - position);
        position = end;
    }
    (power / (high - low)).max(0.0).sqrt()
}

pub struct Analyzer {
    fft: Arc<dyn Fft<f32>>,
    samples: VecDeque<[f32; 2]>,
    buffer: Vec<Complex<f32>>,
    scratch: Vec<Complex<f32>>,
    window: Vec<f32>,
    magnitudes: Vec<f32>,
    music: MusicAnalysis,
}

impl Analyzer {
    pub fn new() -> Self {
        let fft = FftPlanner::new().plan_fft_forward(SIZE);
        let scratch_len = fft.get_inplace_scratch_len();
        Self {
            fft,
            samples: VecDeque::with_capacity(SIZE * 2),
            buffer: vec![Complex::default(); SIZE],
            scratch: vec![Complex::default(); scratch_len],
            magnitudes: vec![0.0; SIZE / 2],
            music: MusicAnalysis::default(),
            window: (0..SIZE)
                .map(|i| {
                    0.5 - 0.5 * (2.0 * std::f32::consts::PI * i as f32 / (SIZE - 1) as f32).cos()
                })
                .collect(),
        }
    }

    pub fn push_stereo(&mut self, bytes: &[u8]) -> Option<Vec<f32>> {
        for frame in bytes.chunks_exact(8) {
            let left = f32::from_le_bytes(frame[..4].try_into().unwrap());
            let right = f32::from_le_bytes(frame[4..].try_into().unwrap());
            self.samples.push_back([
                if left.is_finite() { left } else { 0.0 },
                if right.is_finite() { right } else { 0.0 },
            ]);
        }
        let mut result = None;
        while self.samples.len() >= SIZE {
            // Use actual PCM power; max channel power keeps anti-phase stereo audible.
            let power = self
                .samples
                .iter()
                .take(SIZE)
                .fold([0.0f32; 2], |mut sum, frame| {
                    sum[0] += frame[0] * frame[0];
                    sum[1] += frame[1] * frame[1];
                    sum
                });
            self.music.rms = (power[0].max(power[1]) / SIZE as f32).sqrt();
            self.magnitudes.fill(0.0);
            // Analyze channels independently so opposite-phase stereo does not disappear.
            for channel in 0..2 {
                for (index, value) in self.samples.iter().take(SIZE).enumerate() {
                    self.buffer[index] = Complex::new(value[channel] * self.window[index], 0.0);
                }
                self.fft
                    .process_with_scratch(&mut self.buffer, &mut self.scratch);
                for (index, magnitude) in self.magnitudes.iter_mut().enumerate() {
                    *magnitude = magnitude.max(self.buffer[index].norm());
                }
            }
            let mut bands = vec![0.0; BANDS];
            for (index, band) in bands.iter_mut().enumerate() {
                let low = 35.0 * (16_000.0f32 / 35.0).powf(index as f32 / BANDS as f32);
                let high = 35.0 * (16_000.0f32 / 35.0).powf((index + 1) as f32 / BANDS as f32);
                let magnitude = band_magnitude(
                    &self.magnitudes,
                    low / RATE * SIZE as f32,
                    high / RATE * SIZE as f32,
                ) * 4.0
                    / SIZE as f32;
                let decibels = 20.0 * magnitude.max(1e-8).log10();
                *band = ((decibels + 70.0) / 64.0).clamp(0.0, 1.0);
            }
            // Same six ranges and 48 detailed ranges as the music engine input.
            let db: Vec<f32> = self
                .magnitudes
                .iter()
                .map(|v| 20.0 * (v * 4.0 / SIZE as f32).max(1e-8).log10())
                .collect();
            let audible = self.music.rms > 0.006;
            let range = |start: usize, end: usize| {
                if !audible {
                    return 0.0;
                }
                db[start..end]
                    .iter()
                    .map(|v| ((v + 70.0) / 70.0).max(0.0))
                    .sum::<f32>()
                    / (end - start).max(1) as f32
            };
            let edges = [40.0, 120.0, 300.0, 750.0, 1800.0, 4500.0, 12000.0];
            self.music.bands = edges
                .windows(2)
                .map(|edge| {
                    let start = ((edge[0] * SIZE as f32 / RATE).floor() as usize).max(1);
                    let end = ((edge[1] * SIZE as f32 / RATE).ceil() as usize)
                        .max(start + 1)
                        .min(db.len());
                    range(start, end)
                })
                .collect();
            self.music.spectrum = (0..48)
                .map(|i| {
                    let start =
                        ((i as f32 / 48.0).powf(1.9) * db.len() as f32 * 0.75).floor() as usize;
                    let end = (((i + 1) as f32 / 48.0).powf(1.9) * db.len() as f32 * 0.75).floor()
                        as usize;
                    range(start, end.max(start + 1).min(db.len()))
                })
                .collect();
            // Web Audio default byte spectrum scale (-100 to -30dB), 2048-point FFT equivalent.
            self.music.skin = (0..256)
                .map(|i| {
                    let value = db[(i * 2).min(db.len() - 1)];
                    if audible {
                        (((value + 100.0) / 70.0).clamp(0.0, 1.0) * 255.0).round() as u8
                    } else {
                        0
                    }
                })
                .collect();
            self.samples.drain(..HOP);
            result = Some(bands);
        }
        result
    }

    pub fn music_analysis(&self) -> &MusicAnalysis {
        &self.music
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn fractional_bands_integrate_power_without_flat_bin_steps() {
        let bins = [0.0, 2.0, 4.0];
        assert!((band_magnitude(&bins, 0.25, 0.75) - 2.0f32.sqrt()).abs() < 1e-6);
        assert!((band_magnitude(&bins, 0.0, 2.0) - 6.0f32.sqrt()).abs() < 1e-6);
        assert!(band_magnitude(&bins, 0.4, 0.5) > band_magnitude(&bins, 0.2, 0.3));
    }
    #[test]
    fn silence_has_no_energy() {
        let bands = Analyzer::new().push_stereo(&vec![0; SIZE * 8]).unwrap();
        assert!(bands.iter().all(|v| *v == 0.0));
    }
    #[test]
    fn one_kilohertz_tone_reaches_the_expected_log_band() {
        let mut bytes = Vec::new();
        for i in 0..SIZE {
            let value = (2.0 * std::f32::consts::PI * 1000.0 * i as f32 / RATE).sin() * 0.2;
            bytes.extend(value.to_le_bytes());
            bytes.extend(value.to_le_bytes());
        }
        let bands = Analyzer::new().push_stereo(&bytes).unwrap();
        let peak = bands
            .iter()
            .enumerate()
            .max_by(|a, b| a.1.total_cmp(b.1))
            .unwrap()
            .0;
        let expected = (1000.0f32 / 35.0).ln() / (16_000.0f32 / 35.0).ln() * BANDS as f32;
        assert!((peak as f32 - expected).abs() < 3.0);
    }

    #[test]
    fn opposite_phase_stereo_keeps_the_same_spectrum() {
        let mut normal = Vec::new();
        let mut inverted = Vec::new();
        for i in 0..SIZE {
            let value = (2.0 * std::f32::consts::PI * 440.0 * i as f32 / RATE).sin() * 0.2;
            normal.extend(value.to_le_bytes());
            normal.extend(value.to_le_bytes());
            inverted.extend(value.to_le_bytes());
            inverted.extend((-value).to_le_bytes());
        }
        let expected = Analyzer::new().push_stereo(&normal).unwrap();
        let actual = Analyzer::new().push_stereo(&inverted).unwrap();
        assert!(expected.iter().any(|value| *value > 0.5));
        assert!(actual
            .iter()
            .zip(expected)
            .all(|(a, b)| (*a - b).abs() < 1e-6));
    }

    #[test]
    fn music_features_use_real_pcm_power_and_frequency_ranges() {
        let mut bytes = Vec::new();
        let frequency = RATE * 85.0 / SIZE as f32;
        let amplitude = 0.2;
        for i in 0..SIZE {
            let value =
                (2.0 * std::f32::consts::PI * frequency * i as f32 / RATE).sin() * amplitude;
            bytes.extend(value.to_le_bytes());
            bytes.extend((-value).to_le_bytes());
        }
        let mut analyzer = Analyzer::new();
        analyzer.push_stereo(&bytes).unwrap();
        let music = analyzer.music_analysis();
        assert!((music.rms - amplitude / 2.0f32.sqrt()).abs() < 1e-5);
        assert_eq!(
            (music.bands.len(), music.spectrum.len(), music.skin.len()),
            (6, 48, 256)
        );
        let band = music
            .bands
            .iter()
            .enumerate()
            .max_by(|a, b| a.1.total_cmp(b.1))
            .unwrap()
            .0;
        assert_eq!(
            band, 3,
            "a 996Hz tone must reach the 750–1800Hz source band"
        );
        assert!(music.skin.iter().any(|v| *v > 150));
        let mut silent = Analyzer::new();
        silent.push_stereo(&vec![0; SIZE * 8]).unwrap();
        assert_eq!(silent.music_analysis().rms, 0.0);
        assert!(silent.music_analysis().bands.iter().all(|v| *v == 0.0));
        assert!(silent.music_analysis().spectrum.iter().all(|v| *v == 0.0));
        assert!(silent.music_analysis().skin.iter().all(|v| *v == 0));
    }
}
