import { ExternalLink, LoaderCircle, QrCode, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { musicClient } from "./client";
import type { MusicSnapshot } from "./types";

export function LoginCard({
  login,
  busy,
  perform,
  platform,
}: {
  login: MusicSnapshot["login"];
  platform: string;
  busy: boolean;
  perform: (action: () => Promise<unknown>) => Promise<void>;
}) {
  const logging = [
    "loading",
    "waiting",
    "scanned",
    "expired",
    "authorization",
    "error",
  ].includes(login.phase);
  const action = (value: "start" | "cancel" | "official") =>
    void perform(() => musicClient.login(value));
  return (
    <div className="library-login-layout">
      <div className="library-login-copy">
        <h3>连接{platform}</h3>
        <p>
          扫码登录后，在这里查看歌单和播放歌曲。
          <br />
          桌面灯效、歌词和音乐卡片会跟随播放。
        </p>
      </div>
      <div className="library-login-card">
        <h3>
          <QrCode size={17} />
          手机扫码登录
        </h3>
        <div
          className={`library-qr ${login.phase === "expired" ? "expired" : ""}`}
        >
          {login.qr ? (
            <img src={login.qr} alt={`${platform}登录二维码`} />
          ) : logging || login.phase === "restoring" ? (
            <LoaderCircle className="spinning" size={26} />
          ) : (
            <QrCode size={52} />
          )}
          {login.phase === "expired" && (
            <Button onClick={() => action("start")}>刷新二维码</Button>
          )}
        </div>
        <p role="status">{login.message || "扫码后在手机上确认登录"}</p>
        {logging ? (
          <>
            <div className="library-login-actions">
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => action("start")}
              >
                <RefreshCw size={13} />
                刷新
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => action("cancel")}
              >
                取消
              </Button>
            </div>
            <Button
              variant="link"
              size="sm"
              disabled={busy}
              onClick={() => action("official")}
            >
              打开官方授权
              <ExternalLink size={12} />
            </Button>
          </>
        ) : (
          <Button
            size="sm"
            disabled={busy || login.phase === "restoring"}
            onClick={() => action("start")}
          >
            {login.phase === "restoring" ? "正在恢复登录…" : "获取登录二维码"}
          </Button>
        )}
        <small>登录凭据仅保存在本机。</small>
      </div>
    </div>
  );
}
