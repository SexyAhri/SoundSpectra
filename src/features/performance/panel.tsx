import { useRef, useState } from "react";
import { Dialog, Tabs } from "radix-ui";
import {
  ArrowLeftRight,
  Clapperboard,
  Download,
  FilePlus2,
  Layers3,
  MoveRight,
  Plus,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import { ModalContent } from "@/components/ui/modal";
import { fadeUpdate } from "@/components/ui/fade-update";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { ChoiceSelect } from "@/components/ui/choice-select";
import { Parameter } from "@/components/ui/parameter";
import type { SpectrumSettings } from "../spectrum/model";
import { cardPosition } from "../desktop-card/card-clock";
import { ShowPreview } from "./preview";
import { PerformanceGuide } from "./guide";
import {
  CueEditor,
  cueIcons,
  cueName,
  cueTime,
  transitionNames,
} from "./cue-editor";
import {
  performanceLoadIssue,
  performanceStatus,
  savePerformance,
  usePerformance,
  usePerformanceConfig,
} from "./runtime";
import {
  exampleShow,
  parsePerformance,
  recordingKey,
  visualSnapshot,
  type Cue,
  type CueAction,
  type PerformanceConfig,
  type Show,
} from "./model";
import { musicEffects } from "../spectrum/music-engine/catalog";
import "./performance.css";

export function PerformancePanel({
  settings,
  region,
  disabled = false,
}: {
  settings: SpectrumSettings;
  region: string;
  disabled?: boolean;
}) {
  const config = usePerformanceConfig(),
    controller = usePerformance(),
    info = controller?.info.current;
  const [open, setOpen] = useState(false),
    [tab, setTab] = useState("cues");
  const [addingCue, setAddingCue] = useState(false);
  const [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [selectedCue, setSelectedCue] = useState("");
  const [action, setAction] = useState<CueAction["type"]>("scene"),
    [seconds, setSeconds] = useState(0);
  const file = useRef<HTMLInputElement>(null);
  const show = config.shows.find((s) => s.id === config.selected);
  const cue = show?.cues.find((c) => c.id === selectedCue) ?? show?.cues[0];
  const attempt = (work: () => void) => {
    try {
      work();
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };
  const save = (next: PerformanceConfig) =>
    attempt(() => {
      savePerformance(next);
      setNotice("已保存到此设备");
    });
  const updateShow = (next: Show) =>
    save({
      ...config,
      shows: config.shows.map((s) => (s.id === next.id ? next : s)),
    });
  const updateCue = (next: Cue) =>
    show &&
    updateShow({
      ...show,
      cues: show.cues.map((c) => (c.id === next.id ? next : c)),
    });
  const addShow = (sample: boolean) => {
    const next: Show = sample
      ? exampleShow()
      : {
          id: crypto.randomUUID(),
          name: "新演出",
          track: null,
          region,
          cues: [],
        };
    next.region = region;
    attempt(() => {
      savePerformance({
        ...config,
        shows: [...config.shows, next],
        selected: next.id,
      });
      setSelectedCue("");
      setNotice("已保存到此设备");
    });
  };
  const addCue = () => {
    if (!show) return;
    const nextAction: CueAction =
      action === "scene"
        ? {
            type: "scene",
            snapshot: visualSnapshot(settings),
            name:
              musicEffects.find((e) => e.value === settings.effect)?.label ??
              "当前区域",
            transition: { ...config.transition },
          }
        : action === "palette"
          ? { type: "palette", palette: "ember" }
          : { type: "camera", durationMs: 5000, yaw: 12, push: 0.14 };
    const next: Cue = {
      id: crypto.randomUUID(),
      timeMs: Math.round(seconds * 1000),
      action: nextAction,
    };
    attempt(() => {
      savePerformance({
        ...config,
        shows: config.shows.map((s) =>
          s.id === show.id ? { ...s, cues: [...s.cues, next] } : s,
        ),
      });
      setSelectedCue(next.id);
      setAddingCue(false);
      setNotice("标记已保存");
    });
  };
  const exportFile = () =>
    attempt(() => {
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(config, null, 2)], {
          type: "application/json",
        }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = "SoundSpectra.performance.json";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  const missingRegion =
    !!show &&
    show.region !== "primary" &&
    !settings.regions.some((r) => r.id === show.region);
  const currentTrack = info ? recordingKey(info) : null;
  const targetVisible =
    show?.region === "primary"
      ? settings.regionVisible
      : settings.regions.find((r) => r.id === show?.region)?.visible;
  const armIssue = !show
    ? "先新建演出或载入示例"
    : !show.cues.length
      ? "先添加一个时间标记"
      : missingRegion
        ? "作用区域已删除，请在演出设置中重新选择"
        : !currentTrack
          ? "请在播放器播放歌曲，等待应用识别"
          : !show.track
            ? "先点「绑定当前曲目」"
            : currentTrack !== show.track
              ? "当前歌曲与绑定曲目不同，请播放原曲或重新绑定"
              : cardPosition(info!, Date.now()) === null
                ? "播放器未提供可靠进度，目前可以独立预演"
                : !targetVisible
                  ? "作用区域已隐藏，请先在工作台显示该区域"
                  : !settings.enabled
                    ? "请先在工作台开启「显示到桌面」"
                    : "";
  const canArm = !armIssue;
  return (
    <>
      <Button
        className="performance-entry"
        size="icon-sm"
        variant="ghost"
        aria-label="演出编排"
        title="演出编排"
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        <Clapperboard size={14} />
      </Button>
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <ModalContent className="performance-workspace">
          <header className="performance-workspace-heading">
            <div className="performance-heading-icon">
              <Clapperboard size={20} />
            </div>
            <div>
              <Dialog.Title>演出编排</Dialog.Title>
              <Dialog.Description>
                在歌曲的指定时刻，切换场景、配色与镜头。
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <IconButton aria-label="关闭演出编排">
                <X size={19} />
              </IconButton>
            </Dialog.Close>
          </header>
          <Tabs.Root
            value={tab}
            onValueChange={(value) =>
              fadeUpdate(".performance-workspace-content[data-state=active]", () => setTab(value))
            }
            className="performance-workspace-tabs"
          >
            <Tabs.List
              aria-label="演出工具"
              className="performance-workspace-tab-list"
            >
              <Tabs.Trigger value="cues">
                <Clapperboard size={14} />
                时间编排
              </Tabs.Trigger>
              <Tabs.Trigger value="transitions">
                <ArrowLeftRight size={14} />
                切换转场
              </Tabs.Trigger>
            </Tabs.List>
            <Tabs.Content
              value="cues"
              className="performance-workspace-content"
            >
              <fieldset
                disabled={disabled}
                className="performance-editor-layout"
              >
                <aside
                  className="performance-score"
                  aria-label="演出与时间标记"
                >
                  <div className="performance-score-heading">
                    <h3>演出</h3>
                    <div>
                      <Button
                        className="performance-new-show"
                        size="sm"
                        variant="outline"
                        aria-label="新建演出"
                        onClick={() => addShow(false)}
                      >
                        <FilePlus2 size={14} />
                        新建
                      </Button>
                      <IconButton
                        aria-label="导入演出"
                        title="导入并替换演出配置"
                        onClick={() => file.current?.click()}
                      >
                        <Upload size={15} />
                      </IconButton>
                    </div>
                  </div>
                  {show && (
                    <>
                      <ChoiceSelect
                        label="选择演出"
                        value={show.id}
                        onChange={(value) => {
                          save({ ...config, selected: value });
                          setSelectedCue("");
                        }}
                        options={config.shows.map((s) => ({
                          value: s.id,
                          label: s.name,
                        }))}
                      />
                      <details className="performance-score-settings">
                        <summary>演出设置</summary>
                        <div className="performance-file-actions">
                          <IconButton
                            aria-label="导出演出"
                            title="导出演出配置"
                            onClick={exportFile}
                          >
                            <Download size={15} />
                          </IconButton>
                        </div>
                        <label>
                          名称
                          <input
                            aria-label="演出名称"
                            maxLength={80}
                            value={show.name}
                            onChange={(e) =>
                              updateShow({ ...show, name: e.target.value })
                            }
                          />
                        </label>
                        <label>
                          作用区域
                          <ChoiceSelect
                            label="演出作用区域"
                            value={show.region}
                            onChange={(value) =>
                              updateShow({ ...show, region: value })
                            }
                            options={[
                              { value: "primary", label: "主区域" },
                              ...settings.regions.map((r) => ({
                                value: r.id,
                                label: r.name,
                              })),
                              ...(missingRegion
                                ? [{ value: show.region, label: "区域已删除" }]
                                : []),
                            ]}
                          />
                        </label>
                        <Button
                          className="performance-delete-score"
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            attempt(() => {
                              const remaining = config.shows.filter(
                                (s) => s.id !== show.id,
                              );
                              savePerformance({
                                ...config,
                                shows: remaining,
                                selected: remaining[0]?.id ?? "",
                              });
                              controller?.arm(null);
                            })
                          }
                        >
                          删除此演出
                        </Button>
                      </details>

                      <div className="performance-cue-list-heading">
                        <span>时间标记</span>
                        <small>{show.cues.length} 个</small>
                      </div>
                      <div
                        className="performance-cue-list"
                        role="list"
                        aria-label="时间标记列表"
                      >
                        {show.cues.map((item, index) => {
                          const Icon = cueIcons[item.action.type];
                          return (
                            <button
                              key={item.id}
                              type="button"
                              role="listitem"
                              aria-label={`选择标记 ${index + 1}：${cueName(item)}`}
                              aria-current={
                                cue?.id === item.id ? "true" : undefined
                              }
                              onClick={() => setSelectedCue(item.id)}
                            >
                              <time>{cueTime(item.timeMs)}</time>
                              <Icon size={14} />
                              <span>{cueName(item)}</span>
                            </button>
                          );
                        })}
                        {!show.cues.length && (
                          <p className="performance-no-cues">
                            从一个场景标记开始，给音乐安排第一个画面。
                          </p>
                        )}
                      </div>
                      <details
                        className="performance-add-cue"
                        open={addingCue}
                        onToggle={(event) =>
                          setAddingCue(event.currentTarget.open)
                        }
                      >
                        <summary>
                          <Plus size={14} />
                          添加时间标记
                        </summary>
                        <div className="performance-add-fields">
                          <label>
                            新增位置（秒）
                            <input
                              aria-label="新标记时间"
                              type="number"
                              min="0"
                              max="86400"
                              step=".1"
                              value={seconds}
                              onChange={(e) =>
                                setSeconds(Number(e.target.value))
                              }
                            />
                          </label>
                          <ChoiceSelect
                            label="新标记动作"
                            value={action}
                            onChange={(value) =>
                              setAction(value as CueAction["type"])
                            }
                            options={[
                              { value: "scene", label: "切换场景快照" },
                              { value: "palette", label: "更换配色" },
                              { value: "camera", label: "一次受控运镜" },
                            ]}
                          />
                          <div>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={addCue}
                            >
                              <Plus size={14} />
                              新增标记
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={
                                !info || cardPosition(info, Date.now()) === null
                              }
                              onClick={() =>
                                info &&
                                setSeconds(
                                  (cardPosition(info, Date.now()) ?? 0) / 1000,
                                )
                              }
                            >
                              当前播放位置
                            </Button>
                          </div>
                        </div>
                      </details>
                    </>
                  )}
                  {!show && (
                    <p className="performance-no-cues">
                      还没有保存的演出。新建一套，或从原创示例开始。
                    </p>
                  )}
                  <Button
                    className="performance-sample-button"
                    size="sm"
                    variant="ghost"
                    onClick={() => addShow(true)}
                  >
                    <Sparkles size={14} />
                    载入原创示例
                  </Button>
                </aside>
                <main className="performance-rehearsal">
                  <PerformanceGuide />
                  {show ? (
                    <>
                      <div className="performance-rehearsal-body">
                        <section
                          className="performance-preview-pane"
                          aria-label="独立预演"
                        >
                          <section
                            className="performance-track"
                            aria-label="演出歌曲"
                          >
                            <div className="performance-track-copy">
                              <span>
                                {show.track && currentTrack === show.track
                                  ? "已绑定当前曲目"
                                  : "演出歌曲"}
                              </span>
                              <strong>{info?.title || "尚未识别到歌曲"}</strong>
                              {info?.artist && <small>{info.artist}</small>}
                            </div>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={!currentTrack || disabled}
                              onClick={() =>
                                updateShow({ ...show, track: currentTrack })
                              }
                            >
                              绑定当前曲目
                            </Button>
                            <p>
                              {show.track && currentTrack === show.track
                                ? "已绑定，开启演出后跟随歌曲进度。"
                                : "独立预演无需绑定；跟随演出前请绑定歌曲。"}
                            </p>
                          </section>
                          <div className="performance-rehearsal-heading">
                            <h3>独立预演</h3>
                            <span>模拟音频</span>
                          </div>
                          <ShowPreview
                            key={show.id}
                            show={show}
                            selectedCue={cue}
                          />
                        </section>
                        {cue ? (
                          <CueEditor
                            cue={cue}
                            index={show.cues.indexOf(cue)}
                            settings={settings}
                            region={region}
                            onChange={updateCue}
                            onError={setError}
                            onDelete={() =>
                              updateShow({
                                ...show,
                                cues: show.cues.filter((c) => c.id !== cue.id),
                              })
                            }
                          />
                        ) : (
                          <p className="performance-editor-hint">
                            在左侧新增标记，选择它来编辑时间与动作。
                          </p>
                        )}
                      </div>
                    </>
                  ) : (
                    <div className="performance-welcome">
                      <Clapperboard size={34} />
                      <span>先试一段，再编自己的</span>
                      <p>
                        例如：0 秒潮汐之结，15 秒切到层海，30 秒进入星尘航道。
                        <br />
                        每个「时间标记」就是歌曲某一刻要发生的变化。
                      </p>
                      <Button variant="outline" onClick={() => addShow(true)}>
                        体验 36 秒原创编排
                        <MoveRight size={15} />
                      </Button>
                      <small>
                        包含三种转场、配色变化和一次运镜，可拖动播放头查看。
                      </small>
                    </div>
                  )}
                </main>
              </fieldset>
            </Tabs.Content>
            <Tabs.Content
              value="transitions"
              className="performance-workspace-content"
            >
              <fieldset
                disabled={disabled}
                className="performance-transition-settings"
              >
                <div>
                  <span className="performance-eyebrow">
                    场景之间，也有值得观看的变化
                  </span>
                  <h3>选择默认切换方式</h3>
                  <p>用于手动切换灯效。时间标记可以单独指定自己的转场。</p>
                </div>
                <div
                  className="performance-transition-options"
                  role="group"
                  aria-label="默认转场"
                >
                  {(
                    [
                      {
                        kind: "dissolve",
                        Icon: Layers3,
                        copy: "上一幅画面缓缓隐去，下一幅自然浮现。",
                        range: "所有三维灯效",
                      },
                      {
                        kind: "particles",
                        Icon: Sparkles,
                        copy: "粒子从原有形体散开，在新构图中重新聚拢。",
                        range: "潮汐之结 ↔ 层海",
                      },
                      {
                        kind: "travel",
                        Icon: MoveRight,
                        copy: "镜头向前推进，把视线带入下一片空间。",
                        range: "回声廊道 ↔ 星尘航道",
                      },
                    ] as const
                  ).map(({ kind, Icon, copy, range }) => (
                    <button
                      type="button"
                      key={kind}
                      aria-pressed={config.transition.kind === kind}
                      onClick={() =>
                        save({
                          ...config,
                          transition: { ...config.transition, kind },
                        })
                      }
                    >
                      <Icon size={27} />
                      <strong>{transitionNames[kind]}</strong>
                      <p>{copy}</p>
                      <small>{range}</small>
                    </button>
                  ))}
                </div>
                <div className="performance-transition-duration">
                  <Parameter
                    label="转场时长"
                    value={config.transition.durationMs / 1000}
                    min={0.2}
                    max={6}
                    step={0.1}
                    unit=" 秒"
                    format={(v) => v.toFixed(1)}
                    onChange={(value) =>
                      save({
                        ...config,
                        transition: {
                          ...config.transition,
                          durationMs: Math.round(value * 1000),
                        },
                      })
                    }
                  />
                </div>
                <p className="performance-transition-note">
                  空间转场仅用于标注的场景组合，其余组合柔和交叠。减少动态时使用短交叠。保留的区域各自转场，增删区域随布局更新。
                </p>
              </fieldset>
            </Tabs.Content>
          </Tabs.Root>
          <footer className="performance-workspace-footer">
            <span
              className={error || performanceLoadIssue() ? "is-error" : ""}
              role={error || performanceLoadIssue() ? "alert" : "status"}
            >
              {error ||
                performanceLoadIssue() ||
                notice ||
                "预演独立运行，不控制本机播放器"}
            </span>
            <div>
              <span>
                {controller?.session
                  ? performanceStatus(controller)
                  : armIssue || "已就绪，可以跟随歌曲演出"}
              </span>
              <Button
                size="sm"
                variant={controller?.session ? "outline" : "default"}
                disabled={
                  disabled || !controller || (!controller.session && !canArm)
                }
                title={
                  controller?.session
                    ? "关闭演出并恢复工作台画面"
                    : armIssue || "跟随绑定歌曲的播放进度"
                }
                aria-pressed={!!controller?.session}
                onClick={() =>
                  controller?.arm(
                    controller.session
                      ? null
                      : {
                          showId: show!.id,
                          track: show!.track!,
                          playerSession: info?.sessionId,
                        },
                  )
                }
              >
                {controller?.session ? "关闭演出" : "开启演出模式"}
              </Button>
            </div>
          </footer>
          <input
            ref={file}
            type="file"
            accept=".json,application/json"
            hidden
            aria-label="导入演出文件"
            onChange={async (e) => {
              const selected = e.target.files?.[0];
              e.target.value = "";
              if (!selected) return;
              try {
                if (selected.size > 1048576)
                  throw Error("演出文件不能超过 1 MB");
                const next = parsePerformance(
                  JSON.parse(await selected.text()),
                );
                savePerformance(next);
                controller?.arm(null);
                setSelectedCue("");
                setNotice("演出配置已完整载入");
                setError("");
              } catch (reason) {
                setError(
                  reason instanceof Error ? reason.message : String(reason),
                );
              }
            }}
          />
        </ModalContent>
      </Dialog.Root>
    </>
  );
}
