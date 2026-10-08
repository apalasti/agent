import { accessSync, constants } from "node:fs";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { complete, resolvePi } from "./src/model.ts";

const SYSTEM_PROMPT = "Follow the instructions in the user's message exactly. Reply with only the requested text.";

export default async function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    model: { type: "string", label: "pi model (provider/model id)", default: "claude-bridge/claude-haiku-5-5" },
    piPath: { type: "string", label: "Path to the pi CLI", default: "pi" },
    extensions: {
      type: "string",
      label: "pi extensions to load, comma-separated paths (empty loads all installed)",
      default: "",
    },
  });

  bb.experimental_aiServices.register({
    id: "pi",
    displayName: "pi",
    async complete(prompt, { signal }) {
      const { model, piPath, extensions } = await settings.get();
      const extensionList = extensions
        .split(",")
        .map((ext) => ext.trim())
        .filter(Boolean);
      return complete({ piPath, model, extensions: extensionList }, SYSTEM_PROMPT, prompt, signal);
    },
    async status() {
      const { piPath } = await settings.get();
      try {
        accessSync(resolvePi(piPath), constants.X_OK);
        return { ready: true };
      } catch {
        return { ready: false, message: `pi CLI not found (${piPath}); set piPath` };
      }
    },
  });
}
