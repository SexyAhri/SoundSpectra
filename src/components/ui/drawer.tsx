import type { ComponentProps } from "react";
import { Dialog } from "radix-ui";
import { cn } from "@/lib/utils";
import "./drawer.css";

/** A side panel with the same focus, dismissal and restoration rules as a dialog. */
export function DrawerContent({
  className,
  ...props
}: ComponentProps<typeof Dialog.Content>) {
  return (
    <Dialog.Portal>
      <Dialog.Overlay className="dialog-backdrop drawer-backdrop" />
      <Dialog.Content {...props} className={cn("drawer-content", className)} />
    </Dialog.Portal>
  );
}
