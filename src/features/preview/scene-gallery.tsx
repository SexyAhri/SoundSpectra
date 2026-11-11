import { SearchField } from "@/components/ui/search-field";
import { Button } from "@/components/ui/button";
import { Check } from "lucide-react";
import { desktopPresets } from "./desktop-scenes";
import type { SavedScene } from "./scene-library";
import { SceneThumbnail } from "./scene-thumbnail";
import "./scene-gallery.css";

interface Props {
  tab: "featured" | "saved";
  onTab: (tab: "featured" | "saved") => void;
  query: string;
  onQuery: (query: string) => void;
  items: SavedScene[];
  selected: string | undefined;
  locked: boolean;
  ready: boolean;
  onPreset: (id: string, name: string) => void;
  onSaved: (item: SavedScene) => void;
  onManage: () => void;
}

/** A browsing surface; selection and persistence stay with the library dialog. */
export function SceneGallery(props: Props) {
  const search = props.query.trim().toLocaleLowerCase();
  const scenes =
    props.tab === "featured"
      ? desktopPresets.filter((item) =>
          `${item.name}${item.description}`
            .toLocaleLowerCase()
            .includes(search),
        )
      : props.items;
  return (
    <div className="scene-gallery">
      <div className="scene-gallery-toolbar">
        <div role="group" aria-label="桌面方案分类">
          <Button
            size="sm"
            variant="ghost"
            aria-pressed={props.tab === "featured"}
            disabled={props.locked}
            onClick={() => props.onTab("featured")}
          >
            精选搭配
          </Button>
          <Button
            size="sm"
            variant="ghost"
            aria-pressed={props.tab === "saved"}
            disabled={props.locked}
            onClick={() => props.onTab("saved")}
          >
            我的收藏
          </Button>
        </div>
        <SearchField
          aria-label="搜索场景"
          placeholder="寻找一种氛围"
          value={props.query}
          disabled={props.locked}
          onChange={(event) => props.onQuery(event.target.value)}
        />
      </div>
      <div className="scene-gallery-grid" aria-label="可选场景">
        {scenes.map((scene) => (
          <button
            className="scene-gallery-card"
            key={scene.id}
            disabled={props.locked}
            aria-pressed={props.selected === scene.id}
            onClick={() =>
              props.tab === "featured"
                ? props.onPreset(scene.id, scene.name)
                : props.onSaved(scene as SavedScene)
            }
          >
            <SceneThumbnail
              scene={scene.scene}
              savedId={props.tab === "saved" ? scene.id : undefined}
              updated={"updated" in scene ? scene.updated : undefined}
            />
            <span className="scene-gallery-card-title">
              {scene.name}
              {props.selected === scene.id && (
                <Check size={15} aria-hidden="true" />
              )}
            </span>
            <span className="scene-gallery-card-description">
              {"description" in scene ? scene.description : "收藏的氛围搭配"}
            </span>
          </button>
        ))}
        {!scenes.length && (
          <div className="scene-gallery-empty">
            <p>
              {props.tab === "saved" && !props.ready
                ? "收藏暂时无法读取，精选搭配仍可预览。"
                : search
                  ? "没有找到这个场景，试试其他名称。"
                  : "把喜欢的搭配收在这里，下次直接进入氛围。"}
            </p>
            {!search && (
              <Button
                size="sm"
                variant="outline"
                disabled={props.locked}
                onClick={props.onManage}
              >
                {props.ready ? "收藏当前搭配" : "管理与恢复收藏"}
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
