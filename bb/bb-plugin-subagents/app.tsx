import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { mountRowStatus, RowStatusPoller } from "./src/rowStatus";
import { HeaderPill, PANEL_ACTION_ID } from "./src/ui/HeaderPill";
import { SubagentsPanel } from "./src/ui/SubagentsPanel";

export default definePluginApp((app) => {
  app.slots.experimental_threadHeaderAction({
    id: "subagents",
    title: "Subagents",
    component: HeaderPill,
  });
  app.slots.threadPanelAction({
    id: PANEL_ACTION_ID,
    title: "Subagents",
    icon: "Bot",
    layout: "flush",
    component: SubagentsPanel,
  });
  app.contentScripts.register({ id: "row-status", mount: mountRowStatus });
  app.slots.experimental_appOverlay({ id: "row-status-poller", component: RowStatusPoller });
});
