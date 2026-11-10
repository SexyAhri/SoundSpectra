import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { Toast } from "radix-ui";
import { CircleAlert, X } from "lucide-react";
import "./music-message.css";

export function MusicMessages({ children }: { children: ReactNode }) {
  return (
    <Toast.Provider duration={5000} label="音乐提示">
      {children}
      {createPortal(
        <Toast.Viewport className="music-message-viewport" label="音乐提示 ({hotkey})" aria-live="off" />,
        document.body,
      )}
    </Toast.Provider>
  );
}

/** Keep the same key while polling; only a new failure should reopen a message. */
export function MusicMessage({ message, action }: {
  message: string;
  action?: { label: string; run: () => void };
}) {
  return (
    <Toast.Root className="music-message" role="alert">
      <CircleAlert size={17} className="music-message-icon" aria-hidden="true" />
      <Toast.Description className="music-message-text">
        {message.replace(/^(?:\[[a-z_]+\]\s*)+/i, "")}
      </Toast.Description>
      {action && <Toast.Action asChild altText={action.label}>
        <button className="music-message-action" onClick={action.run}>{action.label}</button>
      </Toast.Action>}
      <Toast.Close className="music-message-close" aria-label="关闭提示">
        <X size={15} aria-hidden="true" />
      </Toast.Close>
    </Toast.Root>
  );
}
