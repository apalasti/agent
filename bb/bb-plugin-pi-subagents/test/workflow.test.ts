import { describe, expect, it } from "vitest";
import { parseJournal, parseMeta } from "../src/workflow";
import { fixture } from "./fakes";

describe("parseMeta", () => {
  it("reads name, description and phase titles from a real script", () => {
    expect(parseMeta(fixture("tasks/wf_98928077532b.workflow.js"))).toEqual({
      name: "demo-repo-tour",
      description: "Demo: map three areas of this repo in parallel, suggest one improvement each, then synthesize",
      phases: ["Map", "Suggest", "Synthesize"],
    });
  });

  it("ignores titles and names outside the meta object", () => {
    const meta = parseMeta(fixture("tasks/wf_95958c48bb8e.workflow.js"));
    expect(meta).toMatchObject({ name: "migrate-bb-plugins-to-pi", phases: ["Build", "Review"] });
  });

  it("accepts double quotes and backticks, and a meta without phases", () => {
    expect(parseMeta('export const meta = { name: "a \\"b\\"", description: `d` };\nagent("x", { title: "no" })')).toEqual({
      name: 'a "b"',
      description: "d",
      phases: [],
    });
  });

  it("has nothing for a script without meta", () => {
    expect(parseMeta("await agent('hi')")).toEqual({ name: null, description: null, phases: [] });
  });
});

describe("parseJournal", () => {
  it("counts finished agents in a real journal", () => {
    expect(parseJournal(fixture("tasks/wf_98928077532b.workflow.jsonl"))).toEqual({ done: 7, failed: 0 });
  });

  it("dedupes by index with the last write winning, and skips a partial last line", () => {
    const journal = ['{"index":0,"ok":false}', '{"index":1,"ok":false}', '{"index":0,"ok":true}', '{"index":2,"o'].join("\n");
    expect(parseJournal(journal)).toEqual({ done: 2, failed: 1 });
  });

  it("is empty for an empty journal", () => {
    expect(parseJournal("")).toEqual({ done: 0, failed: 0 });
  });
});
