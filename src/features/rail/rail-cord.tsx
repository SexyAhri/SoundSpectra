import { RailFloralCord } from "./rail-floral-cord";
import { RailBotanicalCord } from "./rail-botanical-cord";
import type { railWheel } from "./rail-wheel";
import type { RailSkin } from "./model";
import { getRailSkinTheme } from "./skin-theme";

export function RailCord(props: {
  skin: RailSkin;
  unit: number;
  geometry: ReturnType<typeof railWheel>;
  attachments: number[];
}) {
  const theme = getRailSkinTheme(props.skin);
  const outline =
    (theme.ropeStyle.type === "braided_vine"
      ? 6
      : theme.ropeStyle.thickness + 1.4) * props.unit;
  return (
    <g
      aria-hidden="true"
      style={
        {
          "--rail-outline-width": `${outline}px`,
        } as import("react").CSSProperties
      }
    >
      <path
        className="rail-cord-outline-shadow"
        data-rail-rope-path={props.geometry.path}
        d={props.geometry.path}
        transform={`translate(0 ${props.unit * 0.7})`}
      />
      <path
        className="rail-cord-outline"
        data-rail-rope-path={props.geometry.path}
        d={props.geometry.path}
      />
      {theme.ropeStyle.type === "braided_vine" ? (
        <RailFloralCord {...props} theme={theme} />
      ) : theme.ropeStyle.type === "branch" ? (
        <RailBotanicalCord {...props} />
      ) : (
        <>
          <path
            className="rail-themed-shadow"
            data-rail-rope-path={props.geometry.path}
            d={props.geometry.path}
            transform={`translate(0 ${props.unit})`}
          />
          <path
            className="rail-themed-thread"
            data-rail-rope-path={props.geometry.path}
            d={props.geometry.path}
          />
          <path
            className="rail-thread-fiber"
            data-rail-rope-path={props.geometry.path}
            d={props.geometry.path}
          />
        </>
      )}
    </g>
  );
}
