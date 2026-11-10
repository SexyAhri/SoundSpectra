import type { ComponentProps, ReactElement } from "react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export function MusicHint({
  text,
  children,
  side = "top",
}: {
  text?: string | null;
  children: ReactElement;
  side?: "top" | "bottom" | "left" | "right";
}) {
  if (!text) return children;
  return (
    <Tooltip disableHoverableContent>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent
        className="library-tooltip"
        side={side}
        sideOffset={8}
        collisionPadding={12}
      >
        {text}
      </TooltipContent>
    </Tooltip>
  );
}

/** Keep native title bubbles from competing with the positioned app tooltip. */
export function MusicButton({
  title,
  disabledReason,
  hintSide,
  ...props
}: ComponentProps<typeof Button> & {
  hintSide?: "top" | "bottom" | "left" | "right";
}) {
  const text =
    props.disabled && disabledReason
      ? disabledReason
      : (title ??
        (props.size?.startsWith("icon") ? props["aria-label"] : undefined));
  const button = <Button {...props} />;
  if (!text) return button;
  return (
    <MusicHint text={text} side={hintSide}>
      {props.disabled ? (
        <span className="library-disabled-hint">{button}</span>
      ) : (
        button
      )}
    </MusicHint>
  );
}
