import { useRef, useState } from "react";
import {
  AudioLines,
  Check,
  CheckCheck,
  CircleAlert,
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
  { id: "netease", name: "网易云音乐", icon: AudioLines, tone: "red", scanner: "网易云音乐 App" },
  { id: "kugou", name: "酷狗音乐", icon: Radio, tone: "blue", scanner: "酷狗音乐 App" },
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
  const [pending, setPending] = useState<"start" | "cancel" | "official" | "switch" | null>(null);
  const [notice, setNotice] = useState("");
  const flight = useRef(false);
  const switching = pending === "switch";
  const available = providers.filter((p) =>
    p.capabilities.includes("qr-login"),
  );
  const selected = (login.phase ? providers.find((p) => p.id === login.provider) : undefined)
    ?? available.find((p) => p.id === selectedId) ?? available[0];
  const selectedReady = Boolean(selected?.capabilities.includes("qr-login"));
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
  const verifying = login.phase === "verifying" || login.phase === "connected";
  const logging = Boolean(login.phase);
  const locked = busy || pending !== null;
  const disabled = locked || restoring || verifying;
  const expired = login.phase === "expired";
  const failed = login.phase === "error";
  const scanned = login.phase === "scanned";
  const authorization = login.phase === "authorization";
  const action = async (value: "start" | "cancel" | "official") => {
    if (!selected || flight.current || locked || (value !== "cancel" && (disabled || !selectedReady))) return;
    setSelectedId(selected.id);
    flight.current = true; setPending(value); setNotice("");
    try {
      await perform(async () => {
        await musicClient.login(value, selected.id);
        if (value === "official") setNotice(selected.id === "kugou"
          ? "官方验证窗口已打开，完成验证后请刷新二维码继续登录。"
          : "官方授权窗口已打开，完成后会自动连接。关闭窗口后可在这里再次打开。");
      });
    } finally { flight.current = false; setPending(null); }
  };
  const select = async (id: string) => {
    if (id === selected?.id || disabled || flight.current) return;
    flight.current = true; setPending("switch"); setNotice("");
    try {
      if (login.phase || login.qr) {
        let cancelled = false;
        await perform(async () => {
          await musicClient.login("cancel", login.provider ?? selected?.id);
          cancelled = true;
        });
        if (cancelled) setSelectedId(id);
      } else setSelectedId(id);
    } finally { flight.current = false; setPending(null); }
  };
  const status =
    (pending === "start" ? "正在获取新的登录二维码…" : switching ? "正在切换音乐平台…" : pending === "cancel" ? "正在取消登录…" : "") || login.message ||
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
        <div className="library-connect-panel" aria-busy={locked}>
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
                  {pending === "start" || switching ? (
                    <LoaderCircle className="spinning" size={26} aria-label="正在获取登录状态" />
                  ) : authorization ? (
                    <ShieldCheck size={42} aria-hidden="true" />
                  ) : login.qr && !expired && !failed && !scanned && !verifying ? (
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
                  {restoring || verifying ? (
                    <Button size="sm" disabled><LoaderCircle size={13} className="spinning" />{restoring ? "正在恢复登录…" : "正在连接账号…"}</Button>
                  ) : logging ? (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={disabled || !selectedReady}
                        onClick={() => void action(authorization ? "official" : "start")}
                      >
                        {pending === "start" || pending === "official" ? <LoaderCircle size={13} className="spinning" /> : authorization ? <ExternalLink size={13} /> : <RefreshCw size={13} />}
                        {pending === "start" ? "正在获取…" : pending === "official" ? "正在打开…" : authorization ? "打开官方授权" : failed ? "重试" : expired ? "刷新二维码" : "刷新"}
                      </Button>
                    </>
                  ) : (
                    <Button
                      size="sm"
                      disabled={disabled || !selectedReady}
                      onClick={() => void action("start")}
                    >
                      {pending === "start" ? <LoaderCircle size={14} className="spinning" /> : <QrCode size={14} />}
                      {pending === "start" ? "正在获取…" : "获取登录二维码"}
                    </Button>
                  )}
                  {logging && <Button variant="ghost" size="sm" disabled={locked} onClick={() => void action("cancel")}>{pending === "cancel" ? "正在取消…" : "取消"}</Button>}
                </div>
                {authorization && <Button className="library-login-restart" variant="link" size="sm" disabled={disabled} onClick={() => void action("start")}>刷新二维码</Button>}
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
                  <li>
                    <span>3</span>
                    <div>自动连接账号<small>确认后会自动进入歌单，无需再次点击登录</small></div>
                  </li>
                </ol>
                {!authorization && (
                  <Button
                    variant="link"
                    size="sm"
                    disabled={disabled || !selectedReady}
                    onClick={() => void action("official")}
                  >
                    {pending === "official" ? "正在打开…" : "打开官方授权"}
                    <ExternalLink size={12} />
                  </Button>
                )}
              </div>
            </div>
            {notice && <p className="library-login-notice">{notice}</p>}
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
