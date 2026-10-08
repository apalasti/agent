import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { assemble } from "./src/assemble";
import { rpcContract, type ThreadAgents } from "./src/contract";
import { EVENT_TYPES, foldEvents, type ThreadFacts } from "./src/events";
import { contextWindow } from "./src/piSession";
import { createSessionStore, type SessionStore } from "./src/sessions";

export type { rpcContract } from "./src/contract";

const EVENT_PAGE = 100;

export function createPlugin(store: SessionStore, now: () => number) {
  return async function plugin(bb: BbPluginApi) {
    const folded = new Map<string, { cursor: string; facts: ThreadFacts; drained: Promise<unknown> }>();

    async function drain(threadId: string, state: { cursor: string; facts: ThreadFacts }): Promise<ThreadFacts> {
      for (;;) {
        const page = await bb.sdk.threads.events.list({
          threadId,
          afterSeq: state.cursor,
          limit: String(EVENT_PAGE),
          order: "asc",
          types: [...EVENT_TYPES],
        });
        foldEvents(page, state.facts);
        if (page.length > 0) state.cursor = String(page[page.length - 1]!.seq);
        if (page.length < EVENT_PAGE) return state.facts;
      }
    }

    function threadFacts(threadId: string): Promise<ThreadFacts> {
      const state = folded.get(threadId) ?? { cursor: "0", facts: foldEvents([]), drained: Promise.resolve() };
      folded.set(threadId, state);
      // The pill and the panel poll the same thread; overlapping drains would fold stale pages over newer ones.
      const facts = state.drained.then(() => drain(threadId, state));
      state.drained = facts.catch(() => undefined);
      return facts;
    }

    async function threadEnvironment(threadId: string) {
      const thread = await bb.sdk.threads.get({ threadId, include: "environment" }).catch(() => null);
      const environment = thread && "environment" in thread ? thread.environment : null;
      return { cwd: environment?.path ?? null, environmentId: environment?.id ?? null };
    }

    async function threadAgents(threadId: string): Promise<ThreadAgents> {
      const { providerThreadId } = await threadFacts(threadId);
      const empty: ThreadAgents = { sessionId: null, cwd: null, environmentId: null, lead: null, agents: [], workflows: [] };
      if (!providerThreadId) return empty;
      const [thread, environment] = await Promise.all([store.readThread(providerThreadId), threadEnvironment(threadId)]);
      if (!thread) return empty;
      const { parent } = thread;
      return {
        sessionId: parent.header?.id ?? null,
        cwd: environment.cwd ?? parent.header?.cwd ?? null,
        environmentId: environment.environmentId,
        lead: { model: parent.model, context: parent.context, contextWindow: contextWindow(parent.model, parent.peakContext) },
        ...assemble(parent, thread.children, thread.outputs, thread.workflows, now()),
      };
    }

    bb.rpc.register(rpcContract, {
      threadAgents: ({ threadId }) => threadAgents(threadId),
    });
  };
}

export default createPlugin(createSessionStore(), Date.now);
