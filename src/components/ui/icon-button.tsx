import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";
import { Hint } from "./hint";

export function IconButton({
  className,
  title,
  disabledReason,
  ...props
}: ComponentProps<"button"> & {
  "aria-label": string;
  disabledReason?: string;
}) {
  const button = (
    <button
      type="button"
      className={cn("toolbar-button", className)}
      {...props}
    />
  );
  return (
    <Hint
      text={
        props.disabled && disabledReason
          ? disabledReason
          : (title ?? props["aria-label"])
      }
    >
      {props.disabled ? (
        <span className="disabled-hint">{button}</span>
      ) : (
        button
      )}
    </Hint>
  );
}
