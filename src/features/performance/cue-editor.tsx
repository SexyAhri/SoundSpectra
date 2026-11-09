import { Camera, Layers3, Palette, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ChoiceSelect } from "@/components/ui/choice-select";
import { readLibrary } from "../preview/scene-library";
import { settingsForRegion } from "../spectrum/regions";
import type { SpectrumSettings } from "../spectrum/model";
import {
  musicEffects,
  type MusicEffect,
} from "../spectrum/music-engine/catalog";
import { recommendedMusic } from "../spectrum/effect-presets";
import { defaultSceneView } from "../spectrum/three/view";
import { visualSnapshot, type Cue, type TransitionKind } from "./model";

export const transitionNames: Record<TransitionKind, string> = {
  dissolve: "柔和交叠",
  particles: "粒子散聚",
  travel: "镜头穿越",
};
export const cueIcons = { scene: Layers3, palette: Palette, camera: Camera };
export const cueName = (cue: Cue) =>
  cue.action.type === "scene"
    ? cue.action.name
    : cue.action.type === "palette"
      ? "更换配色"
      : "一次受控运镜";
export const cueTime = (ms: number) => {
  const tenths = Math.round(ms / 100);
  return `${Math.floor(tenths / 600)
    .toString()
    .padStart(2, "0")}:${((tenths % 600) / 10).toFixed(1).padStart(4, "0")}`;
};

export function CueEditor({
  cue,
  index,
  settings,
  region,
  onChange,
  onDelete,
  onError,
}: {
  cue: Cue;
  index: number;
  settings: SpectrumSettings;
  region: string;
  onChange: (cue: Cue) => void;
  onDelete: () => void;
  onError: (message: string) => void;
}) {
  const action = cue.action;
  return (
    <section className="cue-editor" aria-label="所选标记属性">
      <header>
        <div>
          <span>标记 {String(index + 1).padStart(2, "0")}</span>
          <h3>{cueName(cue)}</h3>
        </div>
        <Button
          variant="ghost"
          size="sm"
          aria-label={`删除标记 ${index + 1}`}
          onClick={onDelete}
        >
          <Trash2 size={14} />
          删除
        </Button>
      </header>
      <div className="cue-fields">
        <label>
          歌曲时间（秒）
          <input
            aria-label={`标记 ${index + 1} 时间（秒）`}
            type="number"
            min="0"
            max="86400"
            step=".1"
            value={cue.timeMs / 1000}
            onChange={(e) =>
              onChange({
                ...cue,
                timeMs: Math.round(Number(e.target.value) * 1000),
              })
            }
          />
        </label>
        {action.type === "scene" && (
          <>
            <label>
              标记名称
              <input
                aria-label={`标记 ${index + 1} 名称`}
                maxLength={80}
                value={action.name}
                onChange={(e) =>
                  onChange({
                    ...cue,
                    action: { ...action, name: e.target.value },
                  })
                }
              />
            </label>
            <label className="cue-effect-field">
              这一刻切换到
              <ChoiceSelect
                label={`标记 ${index + 1} 灯效`}
                value={action.snapshot.effect}
                onChange={(value) =>
                  onChange({
                    ...cue,
                    action: {
                      ...action,
                      libraryId: undefined,
                      snapshot: {
                        ...action.snapshot,
                        effect: value as MusicEffect,
                        music: recommendedMusic(value as MusicEffect),
                        view: { ...defaultSceneView },
                      },
                    },
                  })
                }
                options={musicEffects.map(({ value, label }) => ({
                  value,
                  label,
                }))}
              />
            </label>
            <label>
              转场方式
              <ChoiceSelect
                label={`标记 ${index + 1} 转场`}
                value={action.transition.kind}
                onChange={(value) =>
                  onChange({
                    ...cue,
                    action: {
                      ...action,
                      transition: {
                        ...action.transition,
                        kind: value as TransitionKind,
                      },
                    },
                  })
                }
                options={Object.entries(transitionNames).map(
                  ([value, label]) => ({ value, label }),
                )}
              />
            </label>
            <label>
              转场时长（秒）
              <input
                aria-label={`标记 ${index + 1} 转场时长`}
                type="number"
                min=".2"
                max="6"
                step=".1"
                value={action.transition.durationMs / 1000}
                onChange={(e) =>
                  onChange({
                    ...cue,
                    action: {
                      ...action,
                      transition: {
                        ...action.transition,
                        durationMs: Number(e.target.value) * 1000,
                      },
                    },
                  })
                }
              />
            </label>
          </>
        )}
        {action.type === "palette" && (
          <label>
            配色
            <ChoiceSelect
              label={`标记 ${index + 1} 配色`}
              value={action.palette}
              onChange={(value) =>
                onChange({
                  ...cue,
                  action: {
                    type: "palette",
                    palette: value as "iris" | "ember" | "lake",
                  },
                })
              }
              options={[
                { value: "iris", label: "原色" },
                { value: "ember", label: "暖色" },
                { value: "lake", label: "冷色" },
              ]}
            />
          </label>
        )}
        {action.type === "camera" && (
          <>
            <label>
              运镜时长（秒）
              <input
                aria-label={`标记 ${index + 1} 运镜时长`}
                type="number"
                min=".5"
                max="15"
                step=".5"
                value={action.durationMs / 1000}
                onChange={(e) =>
                  onChange({
                    ...cue,
                    action: {
                      ...action,
                      durationMs: Number(e.target.value) * 1000,
                    },
                  })
                }
              />
            </label>
            <label>
              侧转角度
              <input
                aria-label={`标记 ${index + 1} 侧转角度`}
                type="number"
                min="-25"
                max="25"
                value={action.yaw}
                onChange={(e) =>
                  onChange({
                    ...cue,
                    action: { ...action, yaw: Number(e.target.value) },
                  })
                }
              />
            </label>
          </>
        )}
      </div>
      {action.type === "scene" && (
        <details className="cue-snapshot-details">
          <summary>更新场景快照</summary>
          <div className="cue-snapshot-actions">
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                onChange({
                  ...cue,
                  action: {
                    ...action,
                    snapshot: visualSnapshot(settings),
                    libraryId: undefined,
                  },
                })
              }
            >
              <RefreshCw size={13} />
              更新为当前区域
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                try {
                  const latest = readLibrary().sort(
                    (a, b) => b.updated - a.updated,
                  )[0];
                  if (!latest) throw Error("收藏为空，请先在工作台收藏场景。");
                  onChange({
                    ...cue,
                    action: {
                      ...action,
                      name: latest.name,
                      libraryId: latest.id,
                      snapshot: visualSnapshot(
                        settingsForRegion(
                          { ...settings, ...latest.scene },
                          region,
                        ),
                      ),
                    },
                  });
                } catch (reason) {
                  onError(
                    reason instanceof Error ? reason.message : String(reason),
                  );
                }
              }}
            >
              使用最新收藏快照
            </Button>
            <small>快照独立保存，收藏改名或删除后仍可使用。</small>
          </div>
        </details>
      )}
    </section>
  );
}
