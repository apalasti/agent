import type { BbPluginApi } from "@get-bb/plugin-sdk";

export type { rpcContract } from "./src/contract";

export default async function plugin(bb: BbPluginApi) {
  bb.log.info("loaded");
}
