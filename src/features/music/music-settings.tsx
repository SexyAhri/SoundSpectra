import { useEffect, useState } from "react";
import { MusicButton as Button } from "./music-hint";
import {
  AudioLines,
  FileDown,
  HardDrive,
  Moon,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { ChoiceSelect } from "@/components/ui/choice-select";
import { Tabs } from "radix-ui";
import { useUiPreference } from "../settings/use-ui-preference";
import { Switch } from "@/components/ui/switch";
import { musicClient } from "./client";
import type { CacheStats, MusicPreferences, Playback } from "./types";
type SettingsTab = "cache" | "playback" | "tools";
const size = (bytes: number) =>
  bytes >= 1024 ** 3
    ? `${(bytes / 1024 ** 3).toFixed(2)} GiB`
    : `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
export function MusicSettings({
  playback: p,
  command,
  perform,
}: {
  playback: Playback;
  command: (action: string, value?: number) => void;
  perform: (action: () => Promise<unknown>) => Promise<void>;
}) {
  const [tab, setTab] = useUiPreference<SettingsTab>(
    "soundspectra.music-settings-tab",
    "cache",
    (value): value is SettingsTab =>
      ["cache", "playback", "tools"].includes(value as string),
  );
  const [preferences, setPreferences] = useState<MusicPreferences>({
    lyricMib: 32,
    normalize: false,
  });
  const [stats, setStats] = useState<CacheStats | null>(null);
  const [saving, setSaving] = useState(false);
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
  const change = (patch: Partial<MusicPreferences>) => {
    setSaving(true);
    void perform(async () => {
      const next = await musicClient.preferences({ ...preferences, ...patch });
      setPreferences(next);
      setStats(await musicClient.cache());
    }).finally(() => setSaving(false));
  };
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
  const used = stats ? stats.lyricBytes + stats.metadataBytes : 0;
  const usedPercent = stats
    ? Math.min(100, (used / stats.limitBytes) * 100)
    : 0;
  return (
    <Tabs.Root
      className="library-settings"
      value={tab}
      onValueChange={(value) => setTab(value as SettingsTab)}
    >
      <Tabs.List
        className="module-section-nav library-settings-tabs"
        aria-label="音乐库设置分类"
      >
        <Tabs.Trigger value="cache">
          <HardDrive size={14} />
          缓存
        </Tabs.Trigger>
        <Tabs.Trigger value="playback">
          <AudioLines size={14} />
          播放
        </Tabs.Trigger>
        <Tabs.Trigger value="tools">
          <FileDown size={14} />
          工具
        </Tabs.Trigger>
      </Tabs.List>
      <Tabs.Content value="cache" className="library-settings-content">
        <section
          className="library-settings-card"
          aria-labelledby="music-cache-heading"
        >
          <header>
            <span className="library-setting-icon">
              <HardDrive size={17} />
            </span>
            <div>
              <h3 id="music-cache-heading">本地缓存</h3>
              <p>保存歌词与封面，歌曲不占用磁盘缓存</p>
            </div>
          </header>
          <div className="library-cache-usage">
            <div>
              <strong>{stats ? size(used) : "统计中…"}</strong>
              <span>/ {preferences.lyricMib} MiB</span>
            </div>
            <span>
              {usedPercent > 0 && usedPercent < 1
                ? "不足 1%"
                : `${Math.round(usedPercent)}%`}
            </span>
          </div>
          <div
            className="library-cache-meter"
            role="meter"
            aria-label="缓存占用"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={usedPercent}
            aria-valuetext={`${size(used)} / ${preferences.lyricMib} MiB`}
          >
            <i style={{ width: `${usedPercent}%`, minWidth: used ? 3 : 0 }} />
          </div>
          <div className="library-cache-breakdown">
            <span>
              <i />
              歌词 <b>{size(stats?.lyricBytes ?? 0)}</b>
            </span>
            <span>
              <i />
              测量与索引 <b>{size(stats?.metadataBytes ?? 0)}</b>
            </span>
          </div>
          <div className="library-setting-row">
            <span>歌词缓存容量</span>
            <ChoiceSelect
              label="歌词缓存容量"
              value={String(preferences.lyricMib)}
              disabled={saving}
              menuClassName="library-choice-menu"
              onChange={(value) => change({ lyricMib: Number(value) })}
              options={[
                { value: "8", label: "8 MiB", description: "节省磁盘空间" },
                { value: "16", label: "16 MiB", description: "日常使用" },
                { value: "32", label: "32 MiB", description: "默认容量" },
                { value: "64", label: "64 MiB", description: "保留更多歌词" },
              ]}
            />
          </div>
          <div className="library-settings-actions">
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                void perform(async () =>
                  setStats(await musicClient.cache("lyrics")),
                )
              }
            >
              <Trash2 size={13} />
              清理歌词
            </Button>
            {Boolean(stats?.audioBytes) && (
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  void perform(async () =>
                    setStats(await musicClient.cache("audio")),
                  )
                }
              >
                <Trash2 size={13} />
                清理旧音频（{size(stats?.audioBytes ?? 0)}）
              </Button>
            )}
          </div>
          <p className="library-setting-note">
            <ShieldCheck size={14} />
            歌词七天未播放清理 · 封面独立上限 128 MiB
          </p>
          {Boolean(stats?.pending) && (
            <p className="library-setting-pending" role="status">
              当前歌曲正在使用的缓存会在释放后清理。
            </p>
          )}
        </section>
      </Tabs.Content>
      <Tabs.Content value="playback" className="library-settings-content">
        <section
          className="library-settings-card"
          aria-labelledby="music-playback-heading"
        >
          <header>
            <span className="library-setting-icon">
              <AudioLines size={17} />
            </span>
            <div>
              <h3 id="music-playback-heading">聆听偏好</h3>
              <p>按你的习惯播放</p>
            </div>
          </header>
          <div className="library-setting-row">
            <div>
              <label htmlFor="music-normalize">歌曲响度平衡</label>
              <small>
                {preferences.normalize
                  ? "已开启 · 下次播放生效"
                  : "保持歌曲原始音量"}
              </small>
            </div>
            <Switch
              id="music-normalize"
              aria-label="歌曲响度平衡"
              aria-describedby="music-normalize-note"
              checked={preferences.normalize}
              disabled={saving}
              onCheckedChange={(normalize) => change({ normalize })}
            />
          </div>
          <p className="library-setting-description" id="music-normalize-note">
            以 −18 LUFS
            为目标，仅降低过响歌曲。开启后在内存中分析，只保存测量结果，下次播放生效。
          </p>
          <div className="library-setting-row library-sleep-row">
            <span>
              <Moon size={15} />
              睡眠定时
            </span>
            <ChoiceSelect
              label="睡眠定时"
              menuClassName="library-choice-menu"
              value={p.sleepAfterTrack ? "track" : p.sleepAt ? "timer" : "off"}
              onChange={(value) =>
                value === "track"
                  ? command("sleep-track")
                  : command("sleep", value === "off" ? 0 : Number(value))
              }
              options={[
                { value: "off", label: "关闭" },
                ...(p.sleepAt
                  ? [
                      {
                        value: "timer",
                        label: "计时中",
                        description: `${new Date(p.sleepAt).toLocaleTimeString()} 暂停`,
                      },
                    ]
                  : []),
                { value: "900", label: "15 分钟" },
                { value: "1800", label: "30 分钟" },
                { value: "3600", label: "60 分钟" },
                { value: "track", label: "本曲结束" },
              ]}
            />
          </div>
          <p className="library-setting-description">
            到时渐隐暂停，让音乐陪你慢慢入睡。
          </p>
        </section>
      </Tabs.Content>
      <Tabs.Content value="tools" className="library-settings-content">
        <section
          className="library-settings-card library-settings-tools"
          aria-labelledby="music-tools-heading"
        >
          <div>
            <h3 id="music-tools-heading">播放诊断</h3>
            <p>遇到播放问题时，导出记录协助排查。</p>
          </div>
          <Button variant="outline" size="sm" onClick={exportLog}>
            <FileDown size={14} />
            导出播放诊断
          </Button>
        </section>
      </Tabs.Content>
    </Tabs.Root>
  );
}
