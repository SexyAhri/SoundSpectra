import { Popover } from "radix-ui";
import { ListFilter, RefreshCw, X } from "lucide-react";
import { ChoiceSelect } from "@/components/ui/choice-select";
import { Button } from "@/components/ui/button";

export function LibraryViewOptions({
  sort,
  onSort,
  density,
  onDensity,
  refreshing,
  onRefresh,
}: {
  sort: string;
  onSort: (value: string) => void;
  density: string;
  onDensity: (value: string) => void;
  refreshing: boolean;
  onRefresh?: () => void;
}) {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="列表选项"
          title={onRefresh ? "排序、密度与刷新" : "排序与密度"}
        >
          <ListFilter size={17} />
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="library-view-options"
          aria-label="列表选项"
          side="bottom"
          align="end"
          sideOffset={8}
          collisionPadding={12}
        >
          <header>
            <strong>列表选项</strong>
            <Popover.Close asChild>
              <Button variant="ghost" size="icon-sm" aria-label="关闭列表选项">
                <X size={15} />
              </Button>
            </Popover.Close>
          </header>
          <label>
            排序
            <ChoiceSelect
              label="歌曲排序"
              value={sort}
              onChange={onSort}
              menuClassName="library-choice-menu"
              options={[
                { value: "default", label: "歌单顺序" },
                { value: "title", label: "歌曲名称" },
                { value: "artist", label: "歌手" },
                { value: "album", label: "专辑" },
                { value: "duration", label: "时长" },
              ]}
            />
          </label>
          <label>
            密度
            <ChoiceSelect
              label="列表密度"
              value={density}
              onChange={onDensity}
              menuClassName="library-choice-menu"
              options={[
                { value: "comfortable", label: "舒适" },
                { value: "compact", label: "紧凑" },
              ]}
            />
          </label>
          {onRefresh && (
            <Button
              variant="ghost"
              size="sm"
              disabled={refreshing}
              onClick={onRefresh}
            >
              <RefreshCw size={14} />
              刷新歌曲
            </Button>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
