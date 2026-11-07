import {
  createMusicDriver,
  type MusicDriverFrame,
} from "./music-engine/effects/musicDriver";
import type { MusicSettings } from "./music-engine/catalog";
import { demoAnalysis, type MusicAnalysis } from "./music-analysis";
import { createMusicMotionSignal } from "./music-engine/effects/musicSignal";
import { createMusicGate } from "./music-engine/effects/musicGate";

interface Packet {
  audio: MusicAnalysis & { audible: boolean };
  time: number;
  receivedAt: number;
  beatIndex: number;
  beatStrength: number;
  beatTime: number;
  period: number;
  transients: readonly number[];
  bandOnsets: readonly boolean[];
}
interface Driver {
  driver: ReturnType<typeof createMusicDriver>;
  history: MusicDriverFrame[];
  frame: MusicDriverFrame | null;
  usedAt: number;
}
const clamp = (value: number) => Math.max(0, Math.min(1, value));

/** Audio analysis advances on capture packets, never on a view's refresh rate.
 * A stream is shared by all regions. Only appearance-dependent gain/response has a cache.
 * Sample positions define analysis time; receivedAt only maps that clock to the local display.
 */
export class AudioFeatureTimeline {
  private packets: Packet[] = [];
  private drivers = new Map<string, Driver>();
  private source = "";
  private revision = -1;
  private streamId = -1;
  private sequence = -1;
  private readonly rhythm = createMusicMotionSignal();
  private readonly gate = createMusicGate();
  private beatIndex = -1;
  private beatStrength = 0;
  private beatTime = -Infinity;
  private period = 500;
  private clockOffset = NaN;
  private displayTime = NaN;
  private sampledAt = NaN;
  private eventTime = -Infinity;
  generation = 0;
  processed = 0;

  push(audio: MusicAnalysis, receivedAt: number): boolean {
    if ([audio.sourceRevision, audio.streamId, audio.sequence].some(value =>
      value !== undefined && (!Number.isSafeInteger(value) || value < 0))) return false;
    if (audio.samplePosition !== undefined && (!Number.isFinite(audio.samplePosition) ||
      audio.samplePosition < 0 || !audio.sampleRate || !Number.isFinite(audio.sampleRate) || audio.sampleRate <= 0)) return false;
    const revision = audio.sourceRevision ?? 0,
      source = `${revision}:${audio.streamId ?? 0}`;
    if (
      revision < this.revision ||
      (revision === this.revision && (audio.streamId ?? 0) < this.streamId)
    )
      return false;
    if (
      source === this.source &&
      audio.sequence !== undefined &&
      audio.sequence <= this.sequence
    )
      return false;
    const previous = this.packets.at(-1);
    const sampleTime =
      audio.samplePosition !== undefined &&
      audio.sampleRate &&
      audio.sampleRate > 0
        ? (audio.samplePosition / audio.sampleRate) * 1000
        : receivedAt;
    if (!Number.isFinite(sampleTime) || !Number.isFinite(receivedAt)) return false;
    // A busy UI can receive a continuous backlog late; only a gap in the sample
    // clock signals a discontinuity. Arrival jitter must not reset onset history.
    if (
      source !== this.source ||
      (previous && sampleTime - previous.time > 350)
    ) {
      this.packets = [];
      this.drivers.clear();
      this.generation++;
      this.sequence = -1;
      this.rhythm.reset();
      this.gate.reset();
      this.beatIndex = -1;
      this.beatStrength = 0;
      this.beatTime = -Infinity;
      this.period = 500;
      this.clockOffset = receivedAt - sampleTime;
      this.displayTime = this.sampledAt = NaN;
      this.eventTime = -Infinity;
    }
    const last = this.packets.at(-1);
    // A regressing clock is an invalid/out-of-order packet, not an onset.
    if (last && sampleTime <= last.time) return false;
    this.source = source;
    this.revision = revision;
    this.streamId = audio.streamId ?? 0;
    this.sequence = audio.sequence ?? this.sequence + 1;
    const dt = last ? sampleTime - last.time : (1024 / 48000) * 1000;
    // Use the least delayed arrival in a recent capture window. A lifetime
    // minimum assumes identical clock rates and eventually runs seconds ahead
    // of a real device. The display cursor absorbs offset changes continuously.
    let offset = receivedAt - sampleTime;
    for (const packet of this.packets)
      if (sampleTime - packet.time <= 2000)
        offset = Math.min(offset, packet.receivedAt - packet.time);
    this.clockOffset = offset;
    const rms = Number.isFinite(audio.rms) ? Math.max(0, audio.rms) : 0;
    const input = { ...audio, rms, audible: this.gate.update(rms, dt) };
    const onset = this.rhythm.update(
      input,
      sampleTime,
      dt,
      1,
    );
    if (onset.onset) {
      const interval = sampleTime - this.beatTime;
      if (interval >= 65 && interval <= 1500)
        this.period = this.period * 0.7 + interval * 0.3;
      this.beatTime = sampleTime;
      this.beatStrength = onset.intensity;
      this.beatIndex++;
    }
    const packet = {
      audio: input,
      time: sampleTime,
      receivedAt,
      beatIndex: this.beatIndex,
      beatStrength: this.beatStrength,
      beatTime: this.beatTime,
      period: this.period,
      transients: onset.transients,
      bandOnsets: onset.bandOnsets,
    };
    this.packets.push(packet);
    if (this.packets.length > 128) this.packets.shift();
    for (const [key, cache] of this.drivers) {
      // Stop appearance work for hidden views and old slider values. Source events
      // continue independently, so a resumed region cannot replay an old onset.
      if (receivedAt - cache.usedAt > 1500) {
        this.drivers.delete(key);
        continue;
      }
      const [gain, response] = key.split(":");
      this.consume(
        cache,
        packet,
        Number(gain),
        response as MusicSettings["response"],
      );
    }
    this.processed++;
    return true;
  }
  private consume(
    cache: Driver,
    packet: Packet,
    gain: number,
    response: MusicSettings["response"],
  ) {
    cache.frame = cache.driver.updateAudio(
      packet.audio,
      packet.time,
      gain,
      undefined,
      true,
      response,
    );
    cache.history.push(cache.frame);
    if (cache.history.length > 128) cache.history.shift();
  }
  sample(
    now: number,
    settings: Pick<MusicSettings, "sensitivity" | "response">,
  ): MusicDriverFrame | null {
    const packet = this.packets.at(-1);
    if (!packet || now - packet.receivedAt > 350) return null;
    const key = `${settings.sensitivity}:${settings.response}`;
    let cache = this.drivers.get(key);
    if (!cache) {
      cache = {
        driver: createMusicDriver(),
        history: [],
        frame: null,
        usedAt: now,
      };
      for (const packet of this.packets)
        this.consume(cache, packet, settings.sensitivity, settings.response);
      // Region controls have a small bounded state cache, even during continuous slider edits.
      if (this.drivers.size >= 16)
        this.drivers.delete(this.drivers.keys().next().value!);
      this.drivers.set(key, cache);
    }
    cache.usedAt = now;
    const frame = cache.frame!;
    const hop = Math.max(1, frame.dt);
    const desired = now - this.clockOffset - hop;
    if (!Number.isFinite(this.displayTime)) this.displayTime = Math.min(packet.time, desired);
    else if (now > this.sampledAt) {
      const dt = now - this.sampledAt;
      const next = this.displayTime + dt;
      // Correct clock drift by changing rate, never by jumping position. Hold at
      // the newest captured endpoint during a late delivery, without extrapolation.
      const correction = Math.max(-dt * .03, Math.min(dt * .03, desired - next));
      this.displayTime = Math.max(this.displayTime, Math.min(packet.time, next + correction));
    }
    this.sampledAt = Math.max(Number.isFinite(this.sampledAt) ? this.sampledAt : now, now);
    // Events may decay between arrivals, but never get more than one capture
    // hop ahead of available audio. Clock drift must not erase a fresh attack.
    const eventLimit = packet.time + Math.min(hop, Math.max(0, now - packet.receivedAt));
    this.eventTime = Math.max(this.eventTime, Math.min(eventLimit, Math.max(packet.time, now - this.clockOffset)));
    let previous = cache.history[0], current = previous;
    for (const candidate of cache.history) {
      current = candidate;
      if (candidate.now >= this.displayTime) break;
      previous = candidate;
    }
    const blend = clamp((this.displayTime - previous.now) / Math.max(1e-6, current.now - previous.now));
    const mix = (a: number, b: number) => a + (b - a) * blend;
    const elapsed = Math.max(0, this.eventTime - packet.time),
      age = this.eventTime - packet.beatTime;
    const transients = packet.transients.map(value => value * Math.exp(-elapsed / 80));
    return {
      ...frame,
      now: this.eventTime,
      beatAge: age,
      onset: false,
      beatIndex: packet.beatIndex,
      beatStrength: packet.beatStrength,
      period: packet.period,
      intensity: mix(previous.intensity, current.intensity),
      displayIntensity: mix(previous.displayIntensity ?? previous.intensity, current.displayIntensity ?? current.intensity),
      sustain: mix(previous.sustain, current.sustain),
      levels: current.levels.map(
        (value, i) => mix(previous.levels[i], value),
      ),
      spectrum: current.spectrum.map(
        (value, i) =>
          mix(previous.spectrum[i], value),
      ),
      transients,
      bandOnsets: packet.bandOnsets,
      pulse: frame.audible ? Math.max(transients[0], transients[1] * .65, transients[2] * .3) : 0,
    };
  }
}

const demoTimeline = new AudioFeatureTimeline();
let demoSequence = -1;
/** A fixed 1024/48000 demo clock is shared by previews, including 30/60/120Hz views. */
export function demoFeatures(now: number, settings: MusicSettings) {
  const sequence = Math.floor(((now / 1000) * 48000) / 1024);
  const start = Math.max(demoSequence + 1, sequence - 15);
  for (let index = start; index <= sequence; index++) {
    const seconds = (index * 1024) / 48000;
    demoTimeline.push(demoAnalysis(seconds + 1e-8), seconds * 1000);
  }
  demoSequence = sequence;
  return demoTimeline.sample(now, settings);
}
