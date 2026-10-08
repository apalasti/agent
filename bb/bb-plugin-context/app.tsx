import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { ContextPanel } from "./src/ui/ContextPanel";
import { ContextRing, PANEL_ACTION_ID, PANEL_TITLE } from "./src/ui/ContextRing";
import { NATIVE_RING, RING_SLOT_ATTRIBUTE } from "./src/ui/footerSlot";
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
    id: "ring",
    scopes: ["thread"],
    actions: [{ id: "ring", component: ContextRing }],
  });
  app.contentScripts.register({
    id: "hide-native-ring",
    mount() {
      const style = document.createElement("style");
      style.setAttribute("data-context-plugin", "hide-native-ring");
      style.textContent = `[data-follow-up-composer-footer]:has([${RING_SLOT_ATTRIBUTE}]:not(:empty)) ${NATIVE_RING} { display: none; }`;
      document.head.appendChild(style);
      return () => style.remove();
    },
  });
  app.slots.threadPanelAction({
    id: PANEL_ACTION_ID,
    title: PANEL_TITLE,
    icon: GAUGE_ICON,
    layout: "flush",
    component: ContextPanel,
  });
});
