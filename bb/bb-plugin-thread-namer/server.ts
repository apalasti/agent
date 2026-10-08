import { accessSync, constants } from "node:fs";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { complete, resolveClaude } from "./src/model.ts";

const SYSTEM_PROMPT = "Follow the instructions in the user's message exactly. Reply with only the requested text.";

export default async function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    model: { type: "string", label: "Claude Code model (haiku, sonnet, or a full model id)", default: "haiku" },
    claudePath: { type: "string", label: "Path to the claude CLI", default: "claude" },
  });

  bb.experimental_aiServices.register({
    id: "claude-code",
    displayName: "Claude Code",
    async complete(prompt, { signal }) {
      const { model, claudePath } = await settings.get();
      return complete({ claudePath, model }, SYSTEM_PROMPT, prompt, signal);
    },
    async status() {
      const { claudePath } = await settings.get();
      try {
        accessSync(resolveClaude(claudePath), constants.X_OK);
        return { ready: true };
      } catch {
        return { ready: false, message: `claude CLI not found (${claudePath}); set claudePath` };
      }
    },
  });
}
