import { existsSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { projectConfigSchema, type ProjectConfig, type ResolvedConfig } from "./contract";
import { defaultBaseRef, hasGtr, type Runner } from "./git";

export const DEFAULT_OVERLAY_DIR = ".myscripts/agents";

export const DEFAULT_CONFIG: ProjectConfig = {
  baseRef: null,
  overlayDir: null,
  setupCommand: null,
  teardownCommand: null,
  tool: "auto",
};

export interface ConfigStore {
  get<T>(key: string): Promise<T | null | undefined>;
  set(key: string, value: unknown): Promise<void>;
}

const configKey = (projectId: string) => `project:${projectId}`;

export async function loadConfig(store: ConfigStore, projectId: string): Promise<ProjectConfig> {
  const stored = await store.get<unknown>(configKey(projectId));
  const parsed = projectConfigSchema.partial().safeParse(stored ?? {});
  return { ...DEFAULT_CONFIG, ...(parsed.success ? parsed.data : {}) };
}

export async function saveConfig(
  store: ConfigStore,
  projectId: string,
  patch: Partial<ProjectConfig>,
): Promise<ProjectConfig> {
  const next = projectConfigSchema.parse({ ...(await loadConfig(store, projectId)), ...patch });
  await store.set(configKey(projectId), next);
  return next;
}

export function overlayPath(sourceRoot: string, overlayDir: string): string {
  return isAbsolute(overlayDir) ? overlayDir : join(sourceRoot, overlayDir);
}

export async function resolveConfig(config: ProjectConfig, runner: Runner, sourceRoot: string): Promise<ResolvedConfig> {
  const overlayCandidate = config.overlayDir ?? DEFAULT_OVERLAY_DIR;
  const effectiveOverlayDir = existsSync(overlayPath(sourceRoot, overlayCandidate)) ? overlayCandidate : null;
  const effectiveTool =
    config.tool === "auto" ? ((await hasGtr(runner, sourceRoot)) ? "gtr" : "git") : config.tool;
  return {
    ...config,
    effectiveBaseRef: config.baseRef ?? (await defaultBaseRef(runner, sourceRoot)),
    effectiveOverlayDir,
    effectiveTool,
  };
}
