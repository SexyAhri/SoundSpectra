import { useState } from "react";
import {
  AudioLines,
  Check,
  CheckCheck,
  CircleAlert,
  Disc3,
  ExternalLink,
  LoaderCircle,
  Music2,
  QrCode,
  Radio,
  RefreshCw,
  ShieldCheck,
  Smartphone,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { musicClient } from "./client";
import type { MusicProviderInfo, MusicSnapshot } from "./types";

// Presentation only. Availability and authentication come from Native providers.
const platformAppearance = [
  {
    id: "qq",
    name: "QQ 音乐",
    icon: Music2,
    tone: "green",
    scanner: "手机 QQ",
  },
  { id: "netease", name: "网易云音乐", icon: AudioLines, tone: "red" },
  { id: "kugou", name: "酷狗音乐", icon: Radio, tone: "blue" },
  { id: "qishui", name: "汽水音乐", icon: Disc3, tone: "purple" },
];

export function LoginCard({
  login,
  busy,
  perform,
  providers,
}: {
  login: MusicSnapshot["login"];
  providers: MusicProviderInfo[];
  busy: boolean;
  perform: (action: () => Promise<unknown>) => Promise<void>;
}) {
  const [selectedId, setSelectedId] = useState("");
  const [switching, setSwitching] = useState(false);
  const available = providers.filter((p) =>
    p.capabilities.includes("qr-login"),
  );
  const selected = available.find((p) => p.id === selectedId) ?? available[0];
  const platforms = [
    ...providers,
    ...platformAppearance
      .filter((p) => !providers.some((provider) => provider.id === p.id))
      .map((p) => ({ id: p.id, name: p.name, capabilities: [] })),
  ];
  const appearance = platformAppearance.find((p) => p.id === selected?.id);
  const Icon = appearance?.icon ?? Music2;
  const platform = selected?.name ?? "音乐平台";
  const restoring = login.phase === "restoring";
  const logging = Boolean(login.phase) && !restoring;
  const disabled = busy || switching || restoring;
  const expired = login.phase === "expired";
  const failed = login.phase === "error";
  const scanned = login.phase === "scanned";
  const action = (value: "start" | "cancel" | "official") => {
    if (selected && !disabled)
      void perform(() => musicClient.login(value, selected.id));
  };
  const select = async (id: string) => {
    if (id === selected?.id || disabled) return;
    if (login.phase || login.qr) {
      setSwitching(true);
      let cancelled = false;
      await perform(async () => {
        await musicClient.login("cancel", selected?.id);
        cancelled = true;
      });
      if (cancelled) setSelectedId(id);
      setSwitching(false);
    } else setSelectedId(id);
  };
  const status =
    login.message ||
    (restoring
      ? "正在恢复上次的登录…"
      : selected
        ? "获取二维码后，用手机扫码登录"
        : "暂无可连接的平台");

  return (
    <div className="library-login-layout">
      <div className="library-connect">
        <div className="library-connect-heading">
          <h3>连接你的音乐</h3>
          <p>选择音乐平台，将你的歌单带到 SoundSpectra。</p>
        </div>
        <div className="library-connect-panel" aria-busy={switching}>
          <aside className="library-platforms" aria-label="音乐平台">
            <span className="library-platforms-label">音乐平台</span>
            <div className="library-platform-list">
              {platforms.map((provider) => {
                const style = platformAppearance.find(
                  (p) => p.id === provider.id,
                );
                const PlatformIcon = style?.icon ?? Music2;
                const ready = provider.capabilities.includes("qr-login");
                const active = selected?.id === provider.id;
                return (
                  <button
                    key={provider.id}
                    type="button"
                    className="library-platform"
                    aria-pressed={active}
                    disabled={!ready || disabled}
                    onClick={() => void select(provider.id)}
                  >
                    <span
                      className="library-platform-icon"
                      data-tone={style?.tone}
                    >
                      <PlatformIcon size={19} aria-hidden="true" />
                    </span>
                    <span className="library-platform-name">
                      <strong>{provider.name}</strong>
                      <small>{ready ? "可连接" : "待接入"}</small>
                    </span>
                    {active && <Check size={14} aria-hidden="true" />}
                  </button>
                );
              })}
            </div>
            <p>更多平台将沿用同一个音乐库。</p>
          </aside>
          <section
            className="library-login-card"
            aria-label={`${platform}登录`}
          >
            <header className="library-login-heading">
              <span
                className="library-platform-icon"
                data-tone={appearance?.tone}
              >
                <Icon size={23} aria-hidden="true" />
              </span>
              <div>
                <h4>{platform}</h4>
                <p>连接歌单，让歌词与桌面灯效跟随播放。</p>
              </div>
            </header>
            <div className="library-login-body">
              <div className="library-login-scan">
                <div
                  className={`library-qr ${expired || failed ? "expired" : ""}`}
                >
                  {login.qr && !switching ? (
                    <img src={login.qr} alt={`${platform}登录二维码`} />
                  ) : restoring ||
                    switching ||
                    (logging && !expired && !failed && !scanned) ? (
                    <LoaderCircle
                      className="spinning"
                      size={26}
                      aria-label="正在获取登录状态"
                    />
                  ) : scanned ? (
                    <CheckCheck size={42} aria-hidden="true" />
                  ) : failed || expired ? (
                    <CircleAlert size={36} aria-hidden="true" />
                  ) : (
                    <QrCode size={54} strokeWidth={1.4} aria-hidden="true" />
                  )}
                  {expired && (
                    <Button
                      size="sm"
                      disabled={disabled}
                      onClick={() => action("start")}
                    >
                      刷新二维码
                    </Button>
                  )}
                </div>
                <p
                  className="library-login-status"
                  role="status"
                  data-phase={login.phase}
                >
                  {scanned && <CheckCheck size={14} aria-hidden="true" />}
                  {status}
                </p>
                <div className="library-login-actions">
                  {logging ? (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={disabled}
                        onClick={() => action("start")}
                      >
                        <RefreshCw size={13} />
                        {failed ? "重试" : "刷新"}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={disabled}
                        onClick={() => action("cancel")}
                      >
                        取消
                      </Button>
                    </>
                  ) : (
                    <Button
                      size="sm"
                      disabled={disabled || !selected}
                      onClick={() => action("start")}
                    >
                      <QrCode size={14} />
                      {restoring ? "正在恢复登录…" : "获取登录二维码"}
                    </Button>
                  )}
                </div>
              </div>
              <div className="library-login-guide">
                <h5>
                  <Smartphone size={15} aria-hidden="true" />
                  手机扫码登录
                </h5>
                <ol>
                  <li>
                    <span>1</span>
                    <div>
                      打开{appearance?.scanner ?? `${platform} App`}
                      <small>找到「扫一扫」</small>
                    </div>
                  </li>
                  <li>
                    <span>2</span>
                    <div>
                      扫描二维码<small>在手机上确认登录与授权</small>
                    </div>
                  </li>
                </ol>
                {logging && (
                  <Button
                    variant="link"
                    size="sm"
                    disabled={disabled}
                    onClick={() => action("official")}
                  >
                    打开官方授权
                    <ExternalLink size={12} />
                  </Button>
                )}
              </div>
            </div>
            <footer className="library-login-privacy">
              <ShieldCheck size={14} aria-hidden="true" />
              <span>登录凭据仅保存在本机，播放权限以平台账号为准。</span>
            </footer>
          </section>
        </div>
      </div>
    </div>
  );
}
