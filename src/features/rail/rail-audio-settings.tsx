import { useEffect, useRef, useState } from "react";
import { Switch } from "@/components/ui/switch";
import { ChoiceSelect } from "@/components/ui/choice-select";
import { Parameter } from "@/components/ui/parameter";
import {
  railAudioConfig,
  railAudioProfiles,
  type RailAudioConfig,
} from "./audio-config";
import { useRailAudioStatus } from "./use-rail-audio";

export function RailAudioSettings({
  value,
  disabled,
  onChange,
}: {
  value?: RailAudioConfig;
  disabled: boolean;
  onChange: (config: RailAudioConfig) => Promise<void>;
}) {
  const config = railAudioConfig(value);
  const status = useRailAudioStatus(config.enabled);
  const [amount, setAmount] = useState(config.amount);
  const editing = useRef(false),
    latest = useRef(config.amount);
  latest.current = config.amount;
  useEffect(() => {
    if (!editing.current) setAmount(config.amount);
  }, [config.amount]);
  return (
    <section
      className="module-section rail-audio-settings"
      aria-label="拾光绳音乐联动"
    >
      <div className="rail-audio-heading">
        <div>
          <h3>音乐联动</h3>
          {config.enabled && <small role="status">{status}</small>}
        </div>
        <Switch
          aria-label="跟随音乐"
          checked={config.enabled}
          disabled={disabled}
          onCheckedChange={(enabled) => void onChange({ ...config, enabled })}
        />
      </div>
      {config.enabled && (
        <div className="rail-audio-fields">
          <div className="rail-form-row">
            <span>律动方式</span>
            <ChoiceSelect
              label="律动方式"
              value={config.profile}
              disabled={disabled}
              options={railAudioProfiles.map((item) => ({
                value: item.value,
                label: item.label,
                description: item.detail,
              }))}
              onChange={(profile) =>
                void onChange({
                  ...config,
                  profile: railAudioProfiles.find(
                    (item) => item.value === profile,
                  )!.value,
                })
              }
            />
          </div>
          <Parameter
            label="律动幅度"
            value={amount}
            min={0}
            max={100}
            disabled={disabled}
            onChange={(value) => {
              editing.current = true;
              setAmount(value);
            }}
            onCommit={(value) => {
              void onChange({ ...config, amount: value }).finally(() => {
                editing.current = false;
                setAmount(latest.current);
              });
            }}
          />
          <p className="rail-audio-hint">
            靠近或操作时收稳，音乐停止后回归微风。
          </p>
        </div>
      )}
    </section>
  );
}
