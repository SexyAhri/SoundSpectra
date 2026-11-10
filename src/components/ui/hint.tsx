import type { ReactElement } from "react";
import {
  Tooltip,
  TooltipProvider,
  TooltipTrigger,
  TooltipContent,
} from "./tooltip";

export function Hint({
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
    <TooltipProvider delayDuration={400} skipDelayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent side={side}>{text}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
