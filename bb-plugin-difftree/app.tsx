import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { DiffTreePanel } from "./src/ui/DiffTreePanel";

export const PANEL_ACTION_ID = "tree";

export default definePluginApp((app) => {
  app.slots.threadPanelAction({
    id: PANEL_ACTION_ID,
    title: "Diff tree",
    layout: "flush",
    component: DiffTreePanel,
  });
  app.commands.register({
    id: "show",
    title: "Diff tree: show this thread's changes",
    defaultShortcut: { key: "d", mod: true, shift: true },
    isAvailable: (context) => context.threadId !== null,
    run: ({ openPanel }) => {
      openPanel({ actionId: PANEL_ACTION_ID });
    },
  });
});
