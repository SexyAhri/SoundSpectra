import { Monitor, Moon, Sun } from "lucide-react";
import { setThemePreference, useThemePreference } from "./theme";
import "./theme-picker.css";

const choices = [
  { value: "light", label: "浅色", detail: "暖灰白", Icon: Sun },
  { value: "dark", label: "深色", detail: "静夜蓝灰", Icon: Moon },
  { value: "system", label: "跟随系统", detail: "自动切换", Icon: Monitor },
] as const;

export function ThemePicker() {
  const preference = useThemePreference();
  return (
    <div className="theme-picker" role="radiogroup" aria-label="界面主题">
      {choices.map(({ value, label, detail, Icon }, index) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-label={label}
          aria-checked={preference === value}
          tabIndex={preference === value ? 0 : -1}
          className={`theme-choice theme-choice-${value}`}
          onClick={() => setThemePreference(value)}
          onKeyDown={(event) => {
            const direction = ["ArrowRight", "ArrowDown"].includes(event.key)
              ? 1
              : ["ArrowLeft", "ArrowUp"].includes(event.key)
                ? -1
                : 0;
            const next =
              event.key === "Home"
                ? 0
                : event.key === "End"
                  ? choices.length - 1
                  : direction
                    ? (index + direction + choices.length) % choices.length
                    : -1;
            if (next < 0) return;
            event.preventDefault();
            setThemePreference(choices[next].value);
            const buttons =
              event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
                "[role=radio]",
              );
            buttons?.[next].focus();
          }}
        >
          <span className="theme-choice-swatch" aria-hidden="true">
            <Icon size={17} />
            <i />
            <i />
            <i />
          </span>
          <span>
            {label}
            <small>{detail}</small>
          </span>
        </button>
      ))}
    </div>
  );
}
