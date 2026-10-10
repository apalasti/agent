import type { Status } from "../../kit";
import type { TaskState } from "./model";

export const STATE_STATUS: Record<TaskState, Status> = {
  running: "running",
  ready: "ready",
  blocked: "idle",
  done: "done",
};

export const STATE_LABEL: Record<TaskState, string> = {
  running: "Running",
  ready: "Ready",
  blocked: "Blocked",
  done: "Done",
};
