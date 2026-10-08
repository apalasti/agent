import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { HeaderPill, PANEL_ACTION_ID } from "./src/ui/HeaderPill";
import { SubagentsPanel } from "./src/ui/SubagentsPanel";

export default definePluginApp((app) => {
  app.slots.experimental_threadHeaderAction({ id: PANEL_ACTION_ID, title: "Claude subagents", component: HeaderPill });
  app.slots.threadPanelAction({
    id: PANEL_ACTION_ID,
    title: "Claude subagents",
    icon: "Bot",
    layout: "flush",
    component: SubagentsPanel,
  });
});
