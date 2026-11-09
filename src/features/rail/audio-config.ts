export const railAudioProfiles = [
  { value: "gentle", label: "轻柔呼吸", detail: "随音量轻轻起伏" },
  { value: "bounce", label: "节拍轻弹", detail: "强拍轻弹，随后自然回落" },
  { value: "string", label: "琴弦共振", detail: "低频化作细小波纹" },
] as const;
export type RailAudioProfile = (typeof railAudioProfiles)[number]["value"];
export interface RailAudioConfig {
  enabled: boolean;
  profile: RailAudioProfile;
  amount: number;
}
export const defaultRailAudio: Readonly<RailAudioConfig> = {
  enabled: false,
  profile: "gentle",
  amount: 35,
};
export function railAudioConfig(
  value?: Partial<RailAudioConfig>,
): RailAudioConfig {
  return {
    enabled: value?.enabled === true,
    profile: railAudioProfiles.some((item) => item.value === value?.profile)
      ? value!.profile!
      : defaultRailAudio.profile,
    amount:
      typeof value?.amount === "number" && Number.isFinite(value.amount)
        ? Math.max(0, Math.min(100, value.amount))
        : defaultRailAudio.amount,
  };
}
export function validateRailAudio(value: RailAudioConfig) {
  if (
    !value ||
    typeof value.enabled !== "boolean" ||
    !railAudioProfiles.some((item) => item.value === value.profile) ||
    !Number.isFinite(value.amount) ||
    value.amount < 0 ||
    value.amount > 100
  )
    throw Error("音乐联动设置无效");
}
