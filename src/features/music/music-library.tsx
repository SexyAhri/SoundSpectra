import { DropdownMenu } from "radix-ui";
import { MusicDrawer, useMusicPanel } from "./music-drawer";
import { LogOut, Music2, RefreshCw, Settings2 } from "lucide-react";
import { MusicButton as Button } from "./music-hint";
import { TooltipProvider } from "@/components/ui/tooltip";
import { native } from "../spectrum/bridge";
import { musicClient } from "./client";
import { useMusic } from "./use-music";
import { MusicCover } from "./music-cover";
import { LoginCard } from "./login-card";
import { LibraryContent } from "./library-content";
import { MusicTransport } from "./music-transport";
import { MusicMessage, MusicMessages } from "./music-message";
import "./music.css";

export function MusicLibrary() {
  const { snapshot, error, busy, perform, command } = useMusic();
  const panels = useMusicPanel();
  const { panel, setPanel } = panels;
  const { account, login, playback: p } = snapshot;
  const loginActive = Boolean(login.phase) && login.phase !== "connected";
  const current = p.queue[p.index];
  const message = error || (!loginActive ? p.error : null);
  const playable = !account || Boolean(snapshot.providers.find((provider) => provider.id === account.provider)?.capabilities.includes("playback"));
  return (
    <TooltipProvider delayDuration={400} skipDelayDuration={150}>
      <MusicMessages>
      <section className="workspace-music" aria-label="音乐库">
        <header className="library-heading">
          <div>
            <span className="library-brand-icon">
              <Music2 size={19} />
            </span>
            <h2>音乐库</h2>
            <span>
              {snapshot.providers.find(
                (provider) => provider.id === account?.provider,
              )?.name ?? "连接音乐平台"}
            </span>
          </div>
          {account && !loginActive && (
            <div className="library-account">
              <Button
                variant="ghost"
                size="icon-sm"
                data-music-panel-toggle
                aria-label="音乐库设置"
                aria-pressed={panel === "settings"}
                hintSide="bottom"
                onClick={() =>
                  setPanel(panel === "settings" ? null : "settings")
                }
              >
                <Settings2 size={15} />
              </Button>
              <DropdownMenu.Root>
                <DropdownMenu.Trigger asChild>
                  <button
                    className="library-account-trigger"
                    aria-label="账号菜单"
                  >
                    <MusicCover src={account.avatar} small />
                    <strong>{account.nickname}</strong>
                    <span className="library-membership">
                      {!account.membership
                        ? "会员状态待确认"
                        : account.membership.active
                        ? `${account.membership.name}${account.membership.level || ""}`
                        : "普通用户"}
                    </span>
                  </button>
                </DropdownMenu.Trigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.Content
                    className="context-menu library-account-menu"
                    sideOffset={8}
                    collisionPadding={12}
                  >
                    <DropdownMenu.Label className="context-menu-label">
                      {account.nickname}
                    </DropdownMenu.Label>
                    <p>
                      {account.membership?.expires
                        ? `会员到期：${account.membership.expires}`
                        : (account.membershipIssue ?? "会员权限以平台授权为准")}
                    </p>
                    <DropdownMenu.Separator className="context-menu-separator" />
                    <DropdownMenu.Item
                      className="context-menu-item"
                      aria-label="刷新账号"
                      disabled={busy}
                      onSelect={() =>
                        void perform(() => musicClient.login("refresh-account", account.provider))
                      }
                    >
                      <RefreshCw size={14} />
                      刷新账号
                    </DropdownMenu.Item>
                    <DropdownMenu.Item
                      className="context-menu-item"
                      aria-label="退出登录"
                      disabled={busy}
                      onSelect={() =>
                        void perform(() => musicClient.login("logout", account.provider))
                      }
                    >
                      <LogOut size={14} />
                      退出登录
                    </DropdownMenu.Item>
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu.Root>
            </div>
          )}
        </header>
        {message && <MusicMessage
          key={JSON.stringify([snapshot.libraryKey, account?.provider, error ? "operation" : p.generation, message])}
          message={message}
          action={!error && p.failure?.loginRequired
            ? { label: "重新扫码", run: () => void perform(() => musicClient.login("start", account?.provider)) }
            : !error && p.failure?.retryable && current
              ? { label: "重试播放", run: () => command("retry") }
              : undefined}
        />}
        {!loginActive && account?.membershipIssue && (
          <p className="library-notice">{account.membershipIssue}</p>
        )}
        <div className="library-body">
          <div className="library-browser">
            {!native ? (
              <div className="library-empty">
                <Music2 size={30} />
                <h3>请在桌面版连接音乐账号</h3>
                <p>浏览器预览无法登录账号或播放平台音乐。</p>
              </div>
            ) : account && !loginActive ? (
              <LibraryContent
                playing={p.playing}
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
                providers={snapshot.providers}
              />
            )}
          </div>
          {account && !loginActive && playable && panel && panel !== "settings" && (
            <MusicDrawer
              {...panels}
              panel={panel}
              playback={p}
              command={command}
              perform={perform}
            />
          )}
        </div>
        {native && account && !loginActive && playable && (
          <MusicTransport
            playback={p}
            busy={busy}
            command={command}
            panel={panel === "settings" ? null : panel}
            onPanel={(next) => setPanel(panel === next ? null : next)}
          />
        )}
        {account && !loginActive && panel === "settings" && (
          <MusicDrawer
            {...panels}
            panel={panel}
            playback={p}
            command={command}
            perform={perform}
          />
        )}
      </section>
      </MusicMessages>
    </TooltipProvider>
  );
}
