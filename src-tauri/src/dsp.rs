use rustfft::{num_complex::Complex, Fft, FftPlanner};
use std::sync::atomic::{AtomicU64, Ordering};
use std::{collections::VecDeque, sync::Arc};

pub const BANDS: usize = 96;
const SIZE: usize = 4096;
const HOP: usize = 1024;
const RATE: f32 = 48_000.0;

#[derive(Clone, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MusicAnalysis {
    pub source_revision: u64,
    pub stream_id: u64,
    pub sequence: u64,
    pub sample_position: u64,
    pub sample_rate: u32,
    pub rms: f32,
    pub bands: Vec<f32>,
    pub spectrum: Vec<f32>,
    /// Integrated, window-normalized RMS per range, before display compression.
    pub band_rms: Vec<f32>,
    pub spectrum_rms: Vec<f32>,
    pub skin: Vec<u8>,
}

// One-sided periodogram bin powers are PSD * bin width. Integrate fractional
// bin cells, never average dB or divide by band width (that would be density).
fn range_power(powers: &[f32], low: f32, high: f32) -> f32 {
    let nyquist = (powers.len() - 1) as f32;
    let low = low.max(0.0);
    let high = high.min(nyquist);
    let start = (low.floor() as usize).saturating_sub(1);
    let end = (high.ceil() as usize + 1).min(powers.len());
    (start..end)
        .map(|i| {
            let left = (i as f32 - 0.5).max(0.0);
            let right = (i as f32 + 0.5).min(nyquist);
            let overlap = (high.min(right) - low.max(left)).max(0.0);
            powers[i] * overlap / (right - left)
        })
        .sum()
}

// Artistic compression only: the same RMS always has the same display height.
// 0.5 RMS maps to 1; the exponent preserves quiet detail without adaptive gain.
fn display_level(rms: f32) -> f32 {
    (rms / 0.5).max(0.0).powf(0.4).min(1.0)
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
    channel_powers: [Vec<f32>; 2],
    window_power: f32,
    music: MusicAnalysis,
    pending_music: Vec<MusicAnalysis>,
}

impl Analyzer {
    pub fn new() -> Self {
        Self::with_source_revision(0)
    }

    pub fn with_source_revision(source_revision: u64) -> Self {
        static NEXT_STREAM: AtomicU64 = AtomicU64::new(1);
        let fft = FftPlanner::new().plan_fft_forward(SIZE);
        let scratch_len = fft.get_inplace_scratch_len();
        let window: Vec<f32> = (0..SIZE)
            .map(|i| 0.5 - 0.5 * (2.0 * std::f32::consts::PI * i as f32 / (SIZE - 1) as f32).cos())
            .collect();
        let window_power = window.iter().map(|v| v * v).sum();
        Self {
            fft,
            samples: VecDeque::with_capacity(SIZE * 2),
            buffer: vec![Complex::default(); SIZE],
            scratch: vec![Complex::default(); scratch_len],
            magnitudes: vec![0.0; SIZE / 2],
            channel_powers: [vec![0.0; SIZE / 2 + 1], vec![0.0; SIZE / 2 + 1]],
            window_power,
            music: MusicAnalysis {
                source_revision,
                stream_id: NEXT_STREAM.fetch_add(1, Ordering::Relaxed),
                sample_rate: RATE as u32,
                ..MusicAnalysis::default()
            },
            pending_music: Vec::new(),
            window,
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
            self.music.sequence += 1;
            self.music.sample_position = SIZE as u64 + (self.music.sequence - 1) * HOP as u64;
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
                for (index, power) in self.channel_powers[channel].iter_mut().enumerate() {
                    let sides = if index == 0 || index == SIZE / 2 {
                        1.0
                    } else {
                        2.0
                    };
                    *power =
                        self.buffer[index].norm_sqr() * sides / (SIZE as f32 * self.window_power);
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
            // Strongest channel per range preserves anti-phase and single-sided
            // input. For different content in L/R, these ranges are a union;
            // their sum is deliberately not claimed to equal max-channel RMS².
            let range = |low: f32, high: f32| {
                self.channel_powers
                    .iter()
                    .map(|powers| {
                        range_power(powers, low * SIZE as f32 / RATE, high * SIZE as f32 / RATE)
                    })
                    .fold(0.0f32, f32::max)
                    .sqrt()
            };
            let edges = [40.0, 120.0, 300.0, 750.0, 1800.0, 4500.0, 12000.0];
            self.music.band_rms = edges
                .windows(2)
                .map(|edge| range(edge[0], edge[1]))
                .collect();
            self.music.spectrum_rms = (0..48)
                .map(|i| {
                    range(
                        (i as f32 / 48.0).powf(1.9) * 18_000.0,
                        ((i + 1) as f32 / 48.0).powf(1.9) * 18_000.0,
                    )
                })
                .collect();
            self.music.bands = self
                .music
                .band_rms
                .iter()
                .copied()
                .map(display_level)
                .collect();
            self.music.spectrum = self
                .music
                .spectrum_rms
                .iter()
                .copied()
                .map(display_level)
                .collect();
            // Web Audio default byte spectrum scale (-100 to -30dB), 2048-point FFT equivalent.
            self.music.skin = (0..256)
                .map(|i| {
                    let value = db[(i * 2).min(db.len() - 1)];
                    (((value + 100.0) / 70.0).clamp(0.0, 1.0) * 255.0).round() as u8
                })
                .collect();
            // Preserve every FFT hop when a capture packet contains several windows.
            // The frontend's shared timeline must see transients between rendered frames.
            self.pending_music.push(self.music.clone());
            if self.pending_music.len() > 128 {
                self.pending_music.remove(0);
            }
            self.samples.drain(..HOP);
            result = Some(bands);
        }
        result
    }

    pub fn music_analysis(&self) -> &MusicAnalysis {
        &self.music
    }

    pub fn take_music_frames(&mut self) -> Vec<MusicAnalysis> {
        std::mem::take(&mut self.pending_music)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn tone(frequency: f64, amplitude: f64) -> MusicAnalysis {
        let mut analyzer = Analyzer::new();
        let mut bytes = Vec::new();
        for i in 0..SIZE {
            let value = ((std::f64::consts::TAU * frequency * i as f64 / RATE as f64).sin()
                * amplitude) as f32;
            bytes.extend(value.to_le_bytes());
            bytes.extend(value.to_le_bytes());
        }
        analyzer.push_stereo(&bytes).unwrap();
        analyzer.music_analysis().clone()
    }
    #[test]
    fn normalized_band_power_does_not_dilute_narrow_tones_in_wide_ranges() {
        for (frequency, band) in [(70.3125, 0), (996.09375, 3), (8003.90625, 5)] {
            let audio = tone(frequency, 0.2);
            assert!((audio.band_rms[band] - audio.rms).abs() < 0.00002);
            let total: f32 = audio.spectrum_rms.iter().map(|v| v * v).sum();
            assert!((total - audio.rms.powi(2)).abs() < 0.00001);
            assert!((audio.bands[band] - display_level(audio.rms)).abs() < 0.0001);
        }
    }
    #[test]
    fn fractional_power_ranges_partition_including_dc_and_nyquist() {
        let powers = [1.0, 2.0, 3.0];
        assert_eq!(range_power(&powers, 0.0, 2.0), 6.0);
        let a = range_power(&powers, 0.0, 0.7);
        let b = range_power(&powers, 0.7, 2.0);
        assert!((a + b - 6.0).abs() < 1e-6);
    }
    #[test]
    fn weak_pcm_features_are_not_destroyed_before_frontend_sensitivity() {
        let audio = tone(996.09375, 0.0007);
        assert!(audio.rms < 0.001);
        assert!((audio.band_rms[3] - audio.rms).abs() < 1e-7);
        assert!(audio.bands[3] > 0.0);
        assert!(audio.spectrum.iter().any(|v| *v > 0.0));
    }
    #[test]
    fn feature_packets_keep_each_hop_and_identify_reconnects() {
        let mut first = Analyzer::with_source_revision(7);
        first.push_stereo(&vec![0; (SIZE + HOP * 3) * 8]);
        let frames = first.take_music_frames();
        assert_eq!(frames.len(), 4);
        for (index, frame) in frames.iter().enumerate() {
            assert_eq!(frame.source_revision, 7);
            assert_eq!(frame.sequence, index as u64 + 1);
            assert_eq!(frame.sample_position, (SIZE + index * HOP) as u64);
            assert_eq!(frame.sample_rate, 48_000);
        }
        let second = Analyzer::with_source_revision(7);
        assert_ne!(frames[0].stream_id, second.music_analysis().stream_id);
        assert!(first.take_music_frames().is_empty());
    }
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
