import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { musicClient } from "./client";
import type { CacheStats, MusicPreferences, Playback } from "./types";
const size = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
export function MusicSettings({
  playback: p,
  command,
  perform,
}: {
  playback: Playback;
  command: (action: string, value?: number) => void;
  perform: (action: () => Promise<unknown>) => Promise<void>;
}) {
  const [preferences, setPreferences] = useState<MusicPreferences>({
    cacheGib: 4,
    normalize: false,
  });
  const [stats, setStats] = useState<CacheStats | null>(null);
  useEffect(() => {
    void perform(async () => {
      const [prefs, cache] = await Promise.all([
        musicClient.preferences(),
        musicClient.cache(),
      ]);
      if (prefs) setPreferences(prefs);
      setStats(cache);
    });
  }, []);
  const change = (patch: Partial<MusicPreferences>) =>
    void perform(async () =>
      setPreferences(
        await musicClient.preferences({ ...preferences, ...patch }),
      ),
    );
  const exportLog = () =>
    void perform(async () => {
      const log = await musicClient.diagnostics();
      const url = URL.createObjectURL(
        new Blob([JSON.stringify({ version: 1, events: log }, null, 2)], {
          type: "application/json",
        }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = "soundspectra-playback-diagnostics.json";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  return (
    <div className="library-settings">
      <label>
        音频与歌词缓存上限
        <select
          aria-label="缓存容量"
          value={preferences.cacheGib}
          onChange={(e) => change({ cacheGib: Number(e.target.value) })}
        >
          {[1, 2, 4, 8].map((n) => (
            <option key={n} value={n}>
              {n} GiB
            </option>
          ))}
        </select>
      </label>
      <p>七天未播放自动清理。封面缓存独立限制为 128 MiB。</p>
      <p>
        {stats
          ? `音频 ${size(stats.audioBytes)} · 歌词 ${size(stats.lyricBytes)}`
          : "正在统计缓存…"}
      </p>
      <div className="library-settings-actions">
        {(["audio", "lyrics"] as const).map((kind) => (
          <Button
            key={kind}
            variant="outline"
            size="sm"
            onClick={() =>
              void perform(async () => setStats(await musicClient.cache(kind)))
            }
          >
            {kind === "audio" ? "清理音频" : "清理歌词"}
          </Button>
        ))}
      </div>
      {Boolean(stats?.pending) && <p>当前歌曲正在使用的缓存会在释放后清理。</p>}
      <label className="library-setting-check">
        <input
          type="checkbox"
          checked={preferences.normalize}
          onChange={(e) => change({ normalize: e.target.checked })}
        />
        歌曲响度平衡
      </label>
      <p>
        以 −18 LUFS 为目标，仅降低过响歌曲。完整缓存后后台分析，下次播放生效。
      </p>
      <label>
        睡眠定时
        <select
          aria-label="睡眠定时"
          value={p.sleepAfterTrack ? "track" : p.sleepAt ? "timer" : "off"}
          onChange={(e) =>
            e.target.value === "track"
              ? command("sleep-track")
              : command(
                  "sleep",
                  e.target.value === "off" ? 0 : Number(e.target.value),
                )
          }
        >
          <option value="off">关闭</option>
          {p.sleepAt && (
            <option value="timer">
              计时中 · {new Date(p.sleepAt).toLocaleTimeString()}
            </option>
          )}
          <option value="900">15 分钟</option>
          <option value="1800">30 分钟</option>
          <option value="3600">60 分钟</option>
          <option value="track">本曲结束</option>
        </select>
      </label>
      <Button variant="outline" size="sm" onClick={exportLog}>
        导出播放诊断
      </Button>
    </div>
  );
}
