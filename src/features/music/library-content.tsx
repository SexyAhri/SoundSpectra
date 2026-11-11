import { SearchField } from "@/components/ui/search-field";
import { readCoverAccent } from "../desktop-card/cover-colors";
import {
  useState,
  useEffect,
  useRef,
  useMemo,
  type CSSProperties,
} from "react";
import {
  ChevronLeft,
  Heart,
  LoaderCircle,
  Play,
  RefreshCw,
  Search,
  History,
  Library,
  ListMusic,
  Disc3,
  FolderHeart,
} from "lucide-react";
import { MusicButton as Button } from "./music-hint";
import { ChoiceSelect } from "@/components/ui/choice-select";
import { musicClient } from "./client";
import { MusicCover } from "./music-cover";
import { trackKey, type Playback, type Track } from "./types";
import { TrackLyricsPreview } from "./track-lyrics-preview";
import { MusicMessage } from "./music-message";
import { LibraryTrackRow } from "./library-track-row";
import { useUiPreference } from "../settings/use-ui-preference";
import { VirtualRows } from "./virtual-rows";
import type { BrowseState } from "./types";
import { useLibrary } from "./use-library";
import { LibraryViewOptions } from "./library-view-options";

function LibraryBrowser({
  current,
  playing,
  perform,
  initial,
  capabilities,
}: {
  initial?: BrowseState;
  capabilities: string[];
  current?: Playback["queue"][number];
  playing?: boolean;
  busy: boolean;
  perform: (action: () => Promise<unknown>) => Promise<void>;
}) {
  const [query, setQuery] = useState(initial?.query ?? "");
  const [searchQuery, setSearchQuery] = useState(
    initial?.selected?.id === "__remote" ? initial.query : "",
  );
  const hasPlaylists = capabilities.includes("playlists");
  const playable = capabilities.includes("playback");
  const library = useLibrary(true, initial, searchQuery, hasPlaylists);
  const [lyricTrack, setLyricTrack] = useState<Track | null>(null);
  const remote = library.selected?.id === "__remote";
  const lastPlaylist = useRef(
    initial?.selected && !["__remote", "__all"].includes(initial.selected.id)
      ? initial.selected
      : null,
  );
  if (library.selected && !["__remote", "__all"].includes(library.selected.id))
    lastPlaylist.current = library.selected;
  const [density, setDensity] = useUiPreference(
    "soundspectra.music-density",
    "comfortable",
    (v): v is string => v === "comfortable" || v === "compact",
  );
  const [selectedTrack, setSelectedTrack] = useState("");
  const scope = !library.selected
    ? ""
    : remote
      ? "platform"
      : library.selected.id === "__all"
        ? "synced"
        : "playlist";
  const chooseScope = (value: string) => {
    setQuery("");
    setSearchQuery("");
    if (value === "playlist" && lastPlaylist.current)
      library.select(lastPlaylist.current);
    else
      library.select({
        id: value === "platform" ? "__remote" : "__all",
        name: value === "platform" ? "全站搜索" : "全部已同步歌曲",
        cover: null,
        count: 0,
      });
  };
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
  const play = (key: string) =>
    void perform(() =>
      musicClient.play(
        shown.map(trackKey),
        shown.findIndex((t) => trackKey(t) === key),
      ),
    );
  const moreTracks = library.tracks?.nextOffset;
  const CollectionIcon = remote
    ? Search
    : library.selected?.id === "__recent"
      ? History
      : library.selected?.id === "liked"
        ? Heart
        : library.selected?.id === "__all"
          ? Library
          : Disc3;
  const [coverImage, setCoverImage] = useState<string | null>(null);
  const [accent, setAccent] = useState<string | null>(null);
  useEffect(() => {
    let disposed = false;
    setAccent(null);
    if (coverImage)
      void readCoverAccent(coverImage)
        .then((color) => {
          if (!disposed) setAccent(color);
        })
        .catch(() => {});
    return () => {
      disposed = true;
    };
  }, [coverImage]);
  const collectionCover = remote
    ? null
    : (library.selected?.cover ?? all[0]?.cover);
  return (
    <>
      {hasPlaylists && <nav className="library-tabs" aria-label="歌单分类">
        <Button
          variant={library.selected?.id === "__recent" ? "secondary" : "ghost"}
          aria-pressed={library.selected?.id === "__recent"}
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
          <History size={14} />
          最近播放
        </Button>
        <Button
          variant={library.selected?.id === "liked" ? "secondary" : "ghost"}
          aria-pressed={library.selected?.id === "liked"}
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
          aria-pressed={library.collection === "created" && !library.selected}
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
          <ListMusic size={14} />
          创建的歌单
        </Button>
        <Button
          aria-pressed={library.collection === "collected" && !library.selected}
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
          <FolderHeart size={14} />
          收藏的歌单
        </Button>
      </nav>}
      {!playable && <p className="library-notice">可搜索歌曲、查看封面和歌词。播放与歌单功能暂未开放。</p>}
      {lyricTrack && <TrackLyricsPreview track={lyricTrack} onClose={() => setLyricTrack(null)} />}
      <div
        className="library-browser-toolbar"
        data-collection={Boolean(library.selected) || undefined}
      >
        {library.selected && (
          <div
            className="library-collection-heading"
            style={
              {
                "--collection-accent": collectionCover
                  ? (accent ?? "var(--primary)")
                  : "var(--primary)",
              } as CSSProperties
            }
          >
            {hasPlaylists && <Button
              variant="ghost"
              size="icon-sm"
              aria-label="返回歌单"
              onClick={library.back}
            >
              <ChevronLeft size={19} />
            </Button>}
            <span className="library-collection-art" aria-hidden="true">
              {collectionCover ? (
                <MusicCover src={collectionCover} onImage={setCoverImage} />
              ) : (
                <CollectionIcon size={18} strokeWidth={1.5} />
              )}
            </span>
            <div className="library-collection-copy">
              <h3 title={library.selected.name}>{library.selected.name}</h3>
              <p>
                已加载 {all.length} / {library.tracks?.total ?? "…"} 首
                {Boolean(library.tracks?.filtered) &&
                  ` · ${library.tracks!.filtered} 首不可用`}
              </p>
            </div>
          </div>
        )}
        <div className="library-search-bar">
          <ChoiceSelect
            label="搜索范围"
            placeholder="搜索范围"
            menuClassName="library-choice-menu"
            value={scope}
            onChange={chooseScope}
            options={[
              ...(capabilities.includes("search")
                ? [{ value: "platform", label: "平台曲库" }]
                : []),
              ...(hasPlaylists ? [{ value: "synced", label: "已同步歌曲" },
              {
                value: "playlist",
                label: "当前歌单",
                disabled: !lastPlaylist.current,
              }] : []),
            ]}
          />
          <SearchField
            aria-label={remote ? "全站搜索关键词" : "搜索已同步歌曲"}
            placeholder={
              remote ? "搜索歌名、歌手，按回车搜索" : "筛选歌名、歌手或专辑"
            }
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              if (!library.selected)
                library.select({
                  id: "__all",
                  name: "全部已同步歌曲",
                  cover: null,
                  count: 0,
                });
            }}
            onKeyDown={(e) => {
              if (remote && e.key === "Enter") {
                setSearchQuery(query);
                if (query === searchQuery) void library.loadTracks();
              }
            }}
          />
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
        </div>
        {library.selected && <div className="library-collection-actions">
          {playable && <Button size="sm" className="library-play-collection"
            aria-label="播放已加载歌曲" title="播放当前已加载的歌曲" disabled={!shown.length}
            onClick={() => play(trackKey(shown[0]))}><Play size={14} />播放</Button>}
          <LibraryViewOptions sort={sort} onSort={setSort} density={density} onDensity={setDensity}
            refreshing={library.trackBusy} onRefresh={remote ? undefined : () => void library.loadTracks()} />
        </div>}
      </div>
      <div
        className="library-scroll"
        ref={scroller}
        onScroll={(e) => setTop(e.currentTarget.scrollTop)}
      >
        {library.selected ? (
          <>
            {(Boolean(query.trim() && !remote) || library.trackBusy || (!remote && moreTracks != null)) && <div className="library-load-status">
              <span className="library-match-count" role="status">
                {query.trim() && !remote
                  ? `匹配 ${shown.length} 首`
                  : ""}
              </span>
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
            </div>}
            {library.trackError && (
              <MusicMessage key={library.trackError} message={library.trackError}
                action={{ label: "重试", run: () => void library.loadTracks(moreTracks ?? 0) }} />
            )}
            {!remote &&
              !library.complete &&
              library.selected.id !== "__recent" && (
                <p className="library-notice">
                  尚有数据未同步，搜索只包含已同步的歌曲；后台继续更新，可刷新结果。
                </p>
              )}
            <div className="library-track-list">
              <div className="library-track-head">
                <span>#</span>
                <span>歌曲 / 歌手</span>
                <span>专辑</span>
                <span>时长</span>
              </div>
              {
                <VirtualRows
                  count={shown.length}
                  height={density === "compact" ? 49 : 65}
                  row={(i) => {
                    const t = shown[i];
                    return (
                      <LibraryTrackRow
                        key={`${t.provider}:${t.id}`}
                        track={t}
                        index={i}
                        density={density}
                        playing={playing}
                        current={
                          current?.id === t.id &&
                          current.provider === t.provider
                        }
                        selected={selectedTrack === `${t.provider}:${t.id}`}
                        onSelect={() =>
                          setSelectedTrack(`${t.provider}:${t.id}`)
                        }
                        onPlay={() => play(trackKey(t))}
                        playable={playable}
                        onLyrics={capabilities.includes("lyrics") ? () => setLyricTrack(t) : undefined}
                        perform={perform}
                      />
                    );
                  }}
                />
              }
            </div>
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
              <MusicMessage key={library.listError} message={library.listError}
                action={{ label: "重试", run: () => void library.loadLists() }} />
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
  playing?: boolean;
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
  if (!props.capabilities.includes("playlists") && !props.capabilities.includes("search")) {
    return <div className="library-empty"><h3>账号已连接</h3><p>网页曲库功能准备中。</p></div>;
  }
  return initial === undefined ? (
    <div className="library-loading">正在恢复音乐库…</div>
  ) : (
    <LibraryBrowser {...props} initial={initial ?? undefined} />
  );
}
