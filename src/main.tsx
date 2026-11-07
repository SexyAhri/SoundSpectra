import React from "react";
import ReactDOM from "react-dom/client";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SettingsWorkspace } from "@/features/settings/settings-workspace";
import { DesktopOverlay } from "@/features/desktop/desktop-overlay";
import { RailDesktop } from "@/features/rail/rail-desktop";
import { CardControlWindow } from '@/features/desktop-card/card-control-window';
import "@/features/theme/theme";
import "./features/rail/rail.css";
import "./index.css";
import "./features/application/application.css";
import "./features/preview/preview.css";
import "./features/settings/inspector.css";
import "./features/settings/studio.css";
import "./features/settings/workspace-layout.css";
import "./features/settings/workspace-design.css";

if (import.meta.env.DEV) void import('./features/application/resize-diagnostics');

const overlay =
  new URLSearchParams(window.location.search).get("window") === "overlay";
const cardControls = new URLSearchParams(window.location.search).get('window') === 'card-controls';
const rail =
  ["rail", "rail-popup"].includes(new URLSearchParams(window.location.search).get("window") ?? "");
if (overlay || rail || cardControls) document.documentElement.classList.add("overlay-root");
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <TooltipProvider delayDuration={250}>
      {cardControls ? <CardControlWindow /> : rail ? (
        <RailDesktop />
      ) : overlay ? (
        <DesktopOverlay />
      ) : (
        <SettingsWorkspace />
      )}
    </TooltipProvider>
  </React.StrictMode>,
);
