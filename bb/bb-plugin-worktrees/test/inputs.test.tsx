// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { PluginEnvironmentProviderInputsChange, PluginEnvironmentProviderInputsProps } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../src/contract";
import { setDialogTaskInputs } from "../src/ui/taskDraft";

afterEach(() => {
  cleanup();
  setDialogTaskInputs(null);
});

async function renderInputs() {
  const app = await loadPluginApp(() => import("../app"));
  const registration = app.environmentProviderInputs.find((entry) => entry.environmentProviderId === "task-worktree");
  expect(registration).toBeDefined();
  const onChange = vi.fn<(next: PluginEnvironmentProviderInputsChange) => void>();
  const props: PluginEnvironmentProviderInputsProps = {
    projectId: "p1",
    target: { kind: "existing-host", hostId: "h1" },
    value: null,
    onChange,
  };
  const slot = renderSlot<PluginEnvironmentProviderInputsProps, typeof rpcContract>(registration!, props, {
    rpc: {
      validateBranch: ({ branch }: { branch: string }) =>
        branch.includes(" ")
          ? { ok: false, message: "Branch names cannot contain spaces", existingWorktreePath: null }
          : { ok: true, message: null, existingWorktreePath: null },
      branches: () => ({ branches: ["origin/main"] }),
      getConfig: () => ({
        baseRef: null,
        overlayDir: null,
        setupCommand: null,
        teardownCommand: null,
        tool: "auto",
        effectiveBaseRef: "wizz/main",
        effectiveOverlayDir: null,
        effectiveTool: "gtr",
      }),
    } as never,
  });
  return { slot, onChange };
}

describe("task-worktree inputs control", () => {
  it("is ready with no inputs by default, so the backend names the branch", async () => {
    const { slot, onChange } = await renderInputs();
    expect(onChange).toHaveBeenLastCalledWith({ status: "ready", value: {} });
    await slot.findByText("from wizz/main");
  });

  it("blocks submit on an invalid branch and reports ready inputs once it is fixed", async () => {
    const { slot, onChange } = await renderInputs();
    fireEvent.click(slot.getByRole("button", { name: /Task worktree branch/ }));
    const branch = await slot.findByLabelText("Branch");
    fireEvent.change(branch, { target: { value: "bad name" } });
    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith({ status: "blocked", reason: "Branch names cannot contain spaces" }),
    );
    fireEvent.change(branch, { target: { value: "feat/good" } });
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith({ status: "ready", value: { branch: "feat/good" } }));
  });

  it("mirrors the New task dialog's fields while that dialog is open", async () => {
    const { slot, onChange } = await renderInputs();
    act(() => setDialogTaskInputs({ branch: "feat/dialog", from: "origin/dev" }));
    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith({ status: "ready", value: { branch: "feat/dialog", from: "origin/dev" } }),
    );
    expect(slot.getByText("feat/dialog")).toBeTruthy();
  });
});
