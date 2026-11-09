import { useState, useEffect, useRef, useMemo } from "react";
import {
  ChevronLeft,
  Heart,
  LoaderCircle,
  Play,
  RefreshCw,
  Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { musicClient } from "./client";
import { MusicCover } from "./music-cover";
import { clock, trackKey, type Playback } from "./types";
import { ContextMenu } from "@/components/ui/context-menu";
import { VirtualRows } from "./virtual-rows";
import type { BrowseState } from "./types";
import { useLibrary } from "./use-library";

function LibraryBrowser({
  current,
  perform,
  initial,
  capabilities,
}: {
  initial?: BrowseState;
  capabilities: string[];
  current?: Playback["queue"][number];
  busy: boolean;
  perform: (action: () => Promise<unknown>) => Promise<void>;
}) {
  const [query, setQuery] = useState(initial?.query ?? "");
  const [searchQuery, setSearchQuery] = useState(
    initial?.selected?.id === "__remote" ? initial.query : "",
  );
  const library = useLibrary(true, initial, searchQuery);
  const remote = library.selected?.id === "__remote";
  const [sort, setSort] = useState(initial?.sort ?? "default");
  const scroller = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState(initial?.top ?? 0);
  useEffect(() => {
    if (scroller.current && library.tracks)
      scroller.current.scrollTop = initial?.top ?? 0;
  }, [Boolean(library.tracks)]);
  useEffect(() => {
    const value = {
      collection: library.collection,
      selected: library.selected,
      query,
      sort,
      top,
    };
    const timer = setTimeout(
      () => void musicClient.browse(value).catch(() => {}),
      600,
    );
    return () => clearTimeout(timer);
  }, [library.collection, library.selected, query, sort, top]);
  const latestBrowse = useRef<BrowseState | undefined>(undefined);
  latestBrowse.current = {
    collection: library.collection,
    selected: library.selected,
    query,
    sort,
    top,
  };
  useEffect(
    () => () => {
      if (latestBrowse.current)
        void musicClient.browse(latestBrowse.current).catch(() => {});
    },
    [],
  );
  const all = library.tracks?.items ?? [];
  const shown = useMemo(() => {
    const result = all.filter(
      (t) =>
        remote ||
        `${t.title} ${t.artist} ${t.album}`
          .toLowerCase()
          .includes(query.toLowerCase()),
    );
    if (sort !== "default")
      result.sort((a, b) =>
        sort === "duration"
          ? a.duration - b.duration
          : String(a[sort as "title" | "artist" | "album"]).localeCompare(
              String(b[sort as "title" | "artist" | "album"]),
              "zh-CN",
            ),
      );
    return result;
  }, [all, query, remote, sort]);
  const play = (id: string) =>
    void perform(() =>
      musicClient.play(
        shown.map(trackKey),
        shown.findIndex((t) => t.id === id),
      ),
    );
  const moreTracks = library.tracks?.nextOffset;
  return (
    <>
      <nav className="library-tabs" aria-label="歌单分类">
        {capabilities.includes("search") && (
          <Button
            variant={remote ? "secondary" : "ghost"}
            size="sm"
            onClick={() => {
              setQuery("");
              setSearchQuery("");
              library.select({
                id: "__remote",
                name: "全站搜索",
                cover: null,
                count: 0,
              });
            }}
          >
            全站搜索
          </Button>
        )}
        <Button
          variant={library.selected?.id === "__all" ? "secondary" : "ghost"}
          size="sm"
          onClick={() =>
            library.select({
              id: "__all",
              name: "全部已同步歌曲",
              cover: null,
              count: 0,
            })
          }
        >
          本地搜索
        </Button>
        <Button
          variant={library.selected?.id === "__recent" ? "secondary" : "ghost"}
          size="sm"
          onClick={() =>
            library.select({
              id: "__recent",
              name: "最近播放",
              cover: null,
              count: 0,
            })
          }
        >
          最近播放
        </Button>
        <Button
          variant={library.selected?.id === "liked" ? "secondary" : "ghost"}
          size="sm"
          onClick={() => {
            setQuery("");
            library.select({
              id: "liked",
              name: "我喜欢",
              cover: null,
              count: 0,
            });
          }}
        >
          <Heart size={14} />
          我喜欢
        </Button>
        <Button
          variant={
            library.collection === "created" && !library.selected
              ? "secondary"
              : "ghost"
          }
          size="sm"
          onClick={() => {
            library.back();
            library.setCollection("created");
          }}
        >
          创建的歌单
        </Button>
        <Button
          variant={
            library.collection === "collected" && !library.selected
              ? "secondary"
              : "ghost"
          }
          size="sm"
          onClick={() => {
            library.back();
            library.setCollection("collected");
          }}
        >
          收藏的歌单
        </Button>
      </nav>
      <div
        className="library-scroll"
        ref={scroller}
        onScroll={(e) => setTop(e.currentTarget.scrollTop)}
      >
        {library.selected ? (
          <>
            <div className="library-list-heading">
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="返回歌单"
                onClick={library.back}
              >
                <ChevronLeft size={19} />
              </Button>
              <div>
                <h3>{library.selected.name}</h3>
                <p>
                  已加载 {all.length} / {library.tracks?.total ?? "…"} 首
                  {Boolean(library.tracks?.filtered) &&
                    ` · ${library.tracks!.filtered} 首不可用`}
                </p>
              </div>
              <Button
                size="sm"
                disabled={!shown.length}
                onClick={() => play(shown[0].id)}
              >
                <Play size={14} />
                播放已加载歌曲
              </Button>
            </div>
            <div className="library-track-tools">
              <label>
                <Search size={14} />
                <input
                  placeholder={
                    remote ? "输入歌名、歌手，按回车搜索" : "筛选已同步歌曲"
                  }
                  aria-label={remote ? "全站搜索关键词" : "搜索已同步歌曲"}
                  onKeyDown={(e) => {
                    if (remote && e.key === "Enter") {
                      setSearchQuery(query);
                      if (query === searchQuery) void library.loadTracks();
                    }
                  }}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </label>
              {remote && (
                <Button
                  size="sm"
                  onClick={() => {
                    setSearchQuery(query);
                    if (query === searchQuery) void library.loadTracks();
                  }}
                >
                  搜索
                </Button>
              )}
              {!remote && (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={library.trackBusy}
                  onClick={() => void library.loadTracks()}
                >
                  刷新歌曲
                </Button>
              )}
              <select
                aria-label="歌曲排序"
                value={sort}
                onChange={(e) => setSort(e.target.value)}
              >
                <option value="default">歌单顺序</option>
                <option value="title">歌曲名称</option>
                <option value="artist">歌手</option>
                <option value="album">专辑</option>
                <option value="duration">时长</option>
              </select>
              {library.trackBusy ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={library.cancelLoading}
                >
                  <LoaderCircle size={14} className="spinning" />
                  停止加载
                </Button>
              ) : (
                !remote &&
                moreTracks != null && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void library.loadTracks(moreTracks, true)}
                  >
                    加载全部
                  </Button>
                )
              )}
            </div>
            {library.trackError && (
              <div className="error-banner" role="alert">
                {library.trackError}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void library.loadTracks(moreTracks ?? 0)}
                >
                  重试
                </Button>
              </div>
            )}
            {!remote &&
              !library.complete &&
              library.selected.id !== "__recent" && (
                <p className="library-notice">
                  尚有数据未同步，搜索只包含已同步的歌曲；后台继续更新，可刷新结果。
                </p>
              )}
            <div className="library-track-head">
              <span>#</span>
              <span>歌曲 / 歌手</span>
              <span>专辑</span>
              <span>时长</span>
            </div>
            {
              <VirtualRows
                count={shown.length}
                height={61}
                row={(i) => {
                  const t = shown[i];
                  return (
                    <ContextMenu
                      title={`${t.title} · ${t.artist}`}
                      actions={[
                        {
                          id: "play",
                          label: "立即播放",
                          run: () => play(t.id),
                        },
                        {
                          id: "next",
                          label: "下一首播放",
                          run: () =>
                            void perform(() =>
                              musicClient.edit({
                                action: "append",
                                ids: [trackKey(t)],
                                next: true,
                              }),
                            ),
                        },
                        {
                          id: "append",
                          label: "加入队列",
                          run: () =>
                            void perform(() =>
                              musicClient.edit({
                                action: "append",
                                ids: [trackKey(t)],
                                next: false,
                              }),
                            ),
                        },
                        {
                          id: "cover",
                          label: "重新加载封面",
                          disabled: !t.cover,
                          run: () =>
                            window.dispatchEvent(
                              new CustomEvent("music-cover-retry", {
                                detail: t.cover,
                              }),
                            ),
                        },
                      ]}
                    >
                      <button
                        key={t.id}
                        className={`library-track ${current?.id === t.id ? "current" : ""}`}
                        onClick={() => play(t.id)}
                      >
                        <span>{i + 1}</span>
                        <span className="library-track-title">
                          <MusicCover src={t.cover} small />
                          <span>
                            <strong title={t.title}>
                              {t.title}
                              {t.paid && <em>VIP</em>}
                            </strong>
                            <small>{t.artist}</small>
                          </span>
                        </span>
                        <span className="library-track-album">{t.album}</span>
                        <span>{clock(t.duration)}</span>
                      </button>
                    </ContextMenu>
                  );
                }}
              />
            }
            {!shown.length && !library.trackBusy && (
              <div className="library-empty">
                {remote
                  ? searchQuery
                    ? "没有匹配的歌曲"
                    : "输入关键词搜索音乐平台曲库"
                  : query
                    ? "没有匹配的已同步歌曲"
                    : "歌单暂无可用歌曲"}
              </div>
            )}
            {library.trackBusy && (
              <div className="library-loading" role="status">
                <LoaderCircle size={16} className="spinning" />
                正在加载歌曲…
              </div>
            )}
            {!library.trackBusy && moreTracks != null && (
              <div className="library-more">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void library.loadTracks(moreTracks)}
                >
                  加载下一页
                </Button>
              </div>
            )}
          </>
        ) : (
          <>
            <div className="library-list-heading">
              <div>
                <h3>
                  {library.collection === "created"
                    ? "创建的歌单"
                    : "收藏的歌单"}
                </h3>
                <p>选择歌单查看歌曲</p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                disabled={library.listBusy}
                onClick={() => void library.loadLists()}
              >
                <RefreshCw size={14} />
                刷新
              </Button>
            </div>
            {library.listError && (
              <div className="error-banner" role="alert">
                {library.listError}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void library.loadLists()}
                >
                  重试
                </Button>
              </div>
            )}
            <div className="library-playlist-grid">
              {library.playlists?.items.map((list) => (
                <button
                  className="library-playlist"
                  key={list.id}
                  onClick={() => {
                    setQuery("");
                    library.select(list);
                  }}
                >
                  <MusicCover src={list.cover} />
                  <strong>{list.name}</strong>
                  <small>{list.count} 首</small>
                </button>
              ))}
            </div>
            {library.listBusy && (
              <div className="library-loading" role="status">
                <LoaderCircle size={17} className="spinning" />
                正在加载歌单…
              </div>
            )}
            {!library.listBusy &&
              !library.playlists?.items.length &&
              !library.listError && (
                <div className="library-empty">暂无歌单</div>
              )}
            {library.playlists?.nextOffset != null && (
              <div className="library-more">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={library.listBusy}
                  onClick={() =>
                    void library.loadLists(library.playlists!.nextOffset!)
                  }
                >
                  加载更多
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}

export function LibraryContent(props: {
  capabilities: string[];
  current?: Playback["queue"][number];
  busy: boolean;
  perform: (action: () => Promise<unknown>) => Promise<void>;
}) {
  const [initial, setInitial] = useState<BrowseState | null | undefined>(
    undefined,
  );
  useEffect(() => {
    let disposed = false;
    void musicClient
      .browse()
      .then((v) => {
        if (!disposed) setInitial(v);
      })
      .catch(() => {
        if (!disposed) setInitial(null);
      });
    return () => {
      disposed = true;
    };
  }, []);
  return initial === undefined ? (
    <div className="library-loading">正在恢复音乐库…</div>
  ) : (
    <LibraryBrowser {...props} initial={initial ?? undefined} />
  );
}
