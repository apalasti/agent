/**
 * Quality gate for the naming pipeline: replays the most recent real sessions
 * and prints what they would be named. Not loaded by pi.
 *
 *   SN_N=20 node --experimental-strip-types extensions/session-name/eval.ts
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  DEFAULTS,
  buildNamingInput,
  heuristicName,
  parseTitle,
  systemPrompt,
  userPrompt,
} from "./naming.ts";

const KEY = JSON.parse(readFileSync("/Users/andraspalasti/.pi/agent/auth.json", "utf8"))["ollama-cloud"].key;
const MODEL = process.env.SN_MODEL ?? "glm-5.3-flash";
const N = Number(process.env.SN_N ?? 15);
const SESS = "/Users/andraspalasti/.pi/agent/sessions";

function loadBranch(path: string) {
  const entries: any[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line));
    } catch {}
  }
  return entries;
}

async function call(transcript: string) {
  const res = await fetch("https://ollama.com/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${KEY}` },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: systemPrompt(DEFAULTS) },
        { role: "user", content: userPrompt(transcript) },
      ],
    }),
  });
  const json: any = await res.json();
  const msg = json.choices?.[0]?.message;
  if (!msg) return { raw: JSON.stringify(json).slice(0, 200), title: null };
  const raw = [msg.reasoning_content ? `<think>${msg.reasoning_content}</think>` : "", msg.content ?? ""].join("\n");
  return { raw, title: parseTitle(raw, DEFAULTS) };
}

const dirs = readdirSync(SESS);
const files: { path: string; mtime: number }[] = [];
for (const d of dirs) {
  let list: string[];
  try {
    list = readdirSync(join(SESS, d));
  } catch {
    continue;
  }
  for (const f of list) {
    if (f.endsWith(".jsonl")) files.push({ path: join(SESS, d, f), mtime: Date.parse(f.slice(0, 24).replace(/-/g, (m, i) => (i > 9 ? ":" : "-")).replace(/:(\d{3})Z$/, ".$1Z")) || 0 });
  }
}
files.sort((a, b) => b.mtime - a.mtime);

for (const { path } of files.slice(0, N)) {
  const branch = loadBranch(path);
  const transcript = buildNamingInput(branch, DEFAULTS);
  if (!transcript) continue;
  const { raw, title } = await call(transcript);
  console.log("─".repeat(70));
  console.log("file      :", path.split("/").slice(-1)[0].slice(0, 40));
  console.log("input     :", transcript.replace(/\s+/g, " ").slice(0, 160));
  console.log("heuristic :", heuristicName(branch, DEFAULTS));
  console.log("title     :", title ?? `FAILED (raw: ${raw.replace(/\s+/g, " ").slice(-160)})`);
}
