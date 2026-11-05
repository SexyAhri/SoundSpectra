import React from "react";
import ReactDOM from "react-dom/client";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SettingsWorkspace } from "@/features/settings/settings-workspace";
import { DesktopOverlay } from "@/features/desktop/desktop-overlay";
import { RailDesktop } from "@/features/rail/rail-desktop";
import "@/features/theme/theme";
import "./features/rail/rail.css";
import "./index.css";
import "./features/application/application.css";
import "./features/preview/preview.css";
import "./features/settings/inspector.css";
import "./features/settings/studio.css";
import "./features/settings/workspace-layout.css";

const overlay =
  new URLSearchParams(window.location.search).get("window") === "overlay";
const rail =
  new URLSearchParams(window.location.search).get("window") === "rail";
if (overlay || rail) document.documentElement.classList.add("overlay-root");
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <TooltipProvider delayDuration={250}>
      {rail ? (
        <RailDesktop />
      ) : overlay ? (
        <DesktopOverlay />
      ) : (
        <SettingsWorkspace />
      )}
    </TooltipProvider>
  </React.StrictMode>,
);
