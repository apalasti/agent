import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { ComposerMeter, PANEL_ACTION_ID, PANEL_TITLE } from "./src/ui/ComposerMeter";
import { ContextPanel } from "./src/ui/ContextPanel";
import {
  ClearGlyph,
  CLEAR_ICON,
  CompactGlyph,
  COMPACT_ICON,
  ForkGlyph,
  FORK_ICON,
  GaugeGlyph,
  GAUGE_ICON,
} from "./src/ui/icon";

export default definePluginApp((app) => {
  app.experimental_icons.register({ name: GAUGE_ICON, component: GaugeGlyph });
  app.experimental_icons.register({ name: FORK_ICON, component: ForkGlyph });
  app.experimental_icons.register({ name: COMPACT_ICON, component: CompactGlyph });
  app.experimental_icons.register({ name: CLEAR_ICON, component: ClearGlyph });
  app.composer.customize({
    id: "meter",
    scopes: ["thread"],
    banners: [{ id: "meter", chrome: "bare", component: ComposerMeter }],
  });
  app.slots.threadPanelAction({
    id: PANEL_ACTION_ID,
    title: PANEL_TITLE,
    icon: GAUGE_ICON,
    layout: "flush",
    component: ContextPanel,
  });
});
