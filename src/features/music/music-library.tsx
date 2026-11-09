import { useEffect, useState } from "react";
import { LogOut, Music2, RefreshCw, Trash2, Settings2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { native } from "../spectrum/bridge";
import { musicClient } from "./client";
import { useMusic } from "./use-music";
import { MusicCover } from "./music-cover";
import { LoginCard } from "./login-card";
import { LibraryContent } from "./library-content";
import { MusicTransport } from "./music-transport";
import { MusicQueue } from "./music-queue";
import { MusicSettings } from "./music-settings";
import { MusicLyrics } from "./music-lyrics";
import "./music.css";

export function MusicLibrary() {
  const { snapshot, error, setError, busy, perform, command } = useMusic();
  const [panel, setPanel] = useState<"queue" | "lyrics" | "settings" | null>(
    null,
  );
  useEffect(() => {
    if (!panel) return;
    const outside = (event: PointerEvent) => {
      if (
        event.target instanceof Element &&
        !event.target.closest(".library-panel, [data-music-panel-toggle]")
      )
        setPanel(null);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPanel(null);
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [panel]);
  const { account, login, playback: p } = snapshot;
  const current = p.queue[p.index];
  return (
    <section className="workspace-music" aria-label="音乐库">
      <header className="library-heading">
        <div>
          <Music2 size={17} />
          <h2>音乐库</h2>
          <span>
            {snapshot.providers.find(
              (provider) => provider.id === account?.provider,
            )?.name ?? "连接音乐平台"}
          </span>
        </div>
        {account && (
          <div className="library-account">
            <Button
              variant="ghost"
              size="icon-sm"
              data-music-panel-toggle
              aria-label="音乐库设置"
              onClick={() => setPanel(panel === "settings" ? null : "settings")}
            >
              <Settings2 size={15} />
            </Button>
            <MusicCover src={account.avatar} small />
            <strong>{account.nickname}</strong>
            <span
              className="library-membership"
              title={
                account.membership?.expires
                  ? `到期时间：${account.membership.expires}`
                  : undefined
              }
            >
              {account.membership
                ? account.membership.active
                  ? `${account.membership.name}${account.membership.level || ""}`
                  : "普通用户"
                : "会员信息暂不可用"}
            </span>
            <Button
              variant="ghost"
              size="icon-sm"
              title="刷新账号"
              aria-label="刷新账号"
              disabled={busy}
              onClick={() =>
                void perform(() => musicClient.login("refresh-account"))
              }
            >
              <RefreshCw size={14} />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              title="退出登录"
              aria-label="退出登录"
              disabled={busy}
              onClick={() => void perform(() => musicClient.login("logout"))}
            >
              <LogOut size={14} />
            </Button>
          </div>
        )}
      </header>
      {(error || p.error) && (
        <div role="alert" className="error-banner">
          <span>{error || p.error}</span>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              p.failure?.loginRequired
                ? void perform(() => musicClient.login("start"))
                : current
                  ? command("retry")
                  : setError(null)
            }
          >
            {p.failure?.loginRequired
              ? "重新扫码"
              : current
                ? "重试播放"
                : "关闭"}
          </Button>
        </div>
      )}
      {account?.membershipIssue && (
        <p className="library-notice">{account.membershipIssue}</p>
      )}
      {!native ? (
        <div className="library-empty">
          <Music2 size={30} />
          <h3>请在桌面版连接音乐账号</h3>
          <p>浏览器预览无法登录账号或播放平台音乐。</p>
        </div>
      ) : account ? (
        <LibraryContent
          key={snapshot.libraryKey ?? account.nickname}
          current={current}
          busy={busy}
          perform={perform}
          capabilities={
            snapshot.providers.find((p) => p.id === account.provider)
              ?.capabilities ?? []
          }
        />
      ) : (
        <LoginCard
          login={login}
          busy={busy}
          perform={perform}
          platform={snapshot.providers[0]?.name ?? "音乐平台"}
        />
      )}
      {native && (
        <MusicTransport
          playback={p}
          busy={busy}
          command={command}
          panel={panel === "settings" ? null : panel}
          onPanel={(next) => setPanel(panel === next ? null : next)}
        />
      )}
      {panel && (
        <aside
          className="library-panel"
          aria-label={
            panel === "queue"
              ? "播放队列面板"
              : panel === "lyrics"
                ? "歌曲歌词面板"
                : "音乐库设置面板"
          }
        >
          <header>
            <strong>
              {panel === "queue"
                ? `播放队列 · ${p.queue.length} 首`
                : panel === "lyrics"
                  ? "歌曲歌词"
                  : "音乐库设置"}
            </strong>
            <div>
              {panel === "queue" && (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={!p.queue.length}
                  onClick={() => command("clear")}
                >
                  <Trash2 size={13} />
                  清空
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="收起面板"
                onClick={() => setPanel(null)}
              >
                <X size={16} />
              </Button>
            </div>
          </header>
          {panel === "lyrics" ? (
            <MusicLyrics playback={p} command={command} />
          ) : panel === "queue" ? (
            <MusicQueue playback={p} command={command} perform={perform} />
          ) : (
            <MusicSettings playback={p} command={command} perform={perform} />
          )}
        </aside>
      )}
    </section>
  );
}
