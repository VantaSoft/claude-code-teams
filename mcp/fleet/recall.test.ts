/**
 * Port of reclaude's tests/test_ccrecall.py to bun:test against recall.ts.
 * Each test gets a fresh temp CLAUDE_CONFIG_DIR with a seeded transcript.
 */
import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  recallIndex,
  recallSearch,
  recallContext,
  recallSessions,
} from "./recall.ts";

const SESSION = "11111111-2222-3333-4444-555555555555";
const FIXTURE = [
  `{"type":"user","timestamp":"2026-06-01T10:00:00.000Z","message":{"content":"How do we configure the zorblax webhook for telnyx routing?"}}`,
  `{"type":"assistant","timestamp":"2026-06-01T10:00:05.000Z","message":{"content":[{"type":"text","text":"Set the zorblax webhook URL in the Telnyx portal and verify the signature with the public key."}]}}`,
  `{"type":"user","timestamp":"2026-06-01T10:01:00.000Z","message":{"content":[{"type":"tool_result","content":"webhook test OK: quuxify endpoint returned 200"}]}}`,
  `{"type":"user","timestamp":"2026-06-01T10:02:00.000Z","message":{"content":[{"type":"tool_result","content":[{"type":"text","text":"signature verification passed for quuxify"}]}]}}`,
  `this line is not valid json and must be skipped silently`,
  `{"type":"assistant","timestamp":"2026-06-01T10:03:00.000Z","message":{"content":[{"type":"text","text":"ok"}]}}`,
  `{"type":"assistant","timestamp":"2026-06-01T10:04:00.000Z","message":{"content":[{"type":"text","text":"Final note: telnyx zorblax setup is complete."}]}}`,
  ``,
].join("\n");

let tmp: string;
let opts: { configDir: string; dbPath: string };
let proj: string;
let sessionFile: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "recall-test-"));
  opts = { configDir: tmp, dbPath: join(tmp, "recall.db") };
  proj = join(tmp, "projects", "test-project");
  mkdirSync(proj, { recursive: true });
  sessionFile = join(proj, `${SESSION}.jsonl`);
  writeFileSync(sessionFile, FIXTURE);
});
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

test("index reports counts", () => {
  expect(recallIndex(true, opts)).toEqual({ changed: 1, seen: 1 });
});

test("search finds term with snippet + metadata", () => {
  recallIndex(true, opts);
  const rows = recallSearch("zorblax", 8, undefined, opts);
  expect(rows.length).toBeGreaterThan(0);
  expect(rows.some((r) => r.project === "test-project")).toBe(true);
  expect(rows.some((r) => r.session === SESSION)).toBe(true);
  expect(rows.some((r) => r.snippet.includes(">>>"))).toBe(true);
  expect(rows.map((r) => r.snippet).join(" ")).toContain("zorblax");
});

test("search indexes tool results", () => {
  recallIndex(true, opts);
  const rows = recallSearch("quuxify", 8, undefined, opts);
  expect(rows.some((r) => r.role === "tool")).toBe(true);
});

test("search project filter", () => {
  recallIndex(true, opts);
  expect(recallSearch("zorblax", 8, "test-project", opts).length).toBeGreaterThan(0);
  expect(recallSearch("zorblax", 8, "no-such-project", opts).length).toBe(0);
});

test("context scrolls around seq", () => {
  recallIndex(true, opts);
  const text = recallContext(SESSION, 2, 1, opts)
    .map((r) => r.text)
    .join("\n");
  expect(text).toContain("quuxify endpoint returned 200"); // seq 2
  expect(text).toContain("Telnyx portal"); // seq 1
  expect(text).toContain("signature verification passed"); // seq 3
  expect(text).not.toContain("Final note"); // seq 5 out of radius
});

test("sessions lists fixture", () => {
  recallIndex(true, opts);
  const rows = recallSessions(20, opts);
  expect(rows.some((r) => r.session === SESSION && r.project === "test-project")).toBe(true);
});

test("incremental skips unchanged then reindexes changed", () => {
  recallIndex(true, opts);
  expect(recallIndex(false, opts).changed).toBe(0);
  appendFileSync(
    sessionFile,
    `{"type":"user","timestamp":"2026-06-01T11:00:00.000Z","message":{"content":"appended wibblewobble entry"}}\n`,
  );
  expect(recallIndex(false, opts).changed).toBe(1);
  expect(recallSearch("wibblewobble", 8, undefined, opts).length).toBeGreaterThan(0);
});

test("long text is chunked and late chunks searchable", () => {
  const text = "filler words here ".repeat(250) + " gribbleflotz appears only at the end";
  expect(text.length).toBeGreaterThan(4000);
  const line = JSON.stringify({
    type: "assistant",
    timestamp: "2026-06-02T09:00:00.000Z",
    message: { content: [{ type: "text", text }] },
  });
  writeFileSync(join(proj, "aaaa0000-0000-0000-0000-000000000000.jsonl"), line + "\n");
  recallIndex(true, opts);
  expect(recallSearch("gribbleflotz", 8, undefined, opts).length).toBeGreaterThan(0);
});

test("tool results capped at 1500 chars", () => {
  const early = "earlycaptoken";
  const late = "latecaptoken";
  const content = early + " " + "x".repeat(1600) + " " + late;
  const line = JSON.stringify({
    type: "user",
    timestamp: "2026-06-02T10:00:00.000Z",
    message: { content: [{ type: "tool_result", content }] },
  });
  writeFileSync(join(proj, "bbbb0000-0000-0000-0000-000000000000.jsonl"), line + "\n");
  recallIndex(true, opts);
  expect(recallSearch(early, 8, undefined, opts).length).toBeGreaterThan(0);
  expect(recallSearch(late, 8, undefined, opts).length).toBe(0);
});

test("subagent transcripts skipped", () => {
  const sub = join(proj, SESSION, "subagents");
  mkdirSync(sub, { recursive: true });
  writeFileSync(
    join(sub, "agent-1.jsonl"),
    `{"type":"user","message":{"content":"subagent snorkelblast text"}}\n`,
  );
  recallIndex(true, opts);
  expect(recallSearch("snorkelblast", 8, undefined, opts).length).toBe(0);
});

test("fts5 special chars fall back to literal", () => {
  recallIndex(true, opts);
  expect(recallSearch("zorblax-webhook", 8, undefined, opts).length).toBeGreaterThan(0);
  expect(recallSearch("nonexistent-flooble", 8, undefined, opts).length).toBe(0);
});

test("missing projects dir is not fatal", () => {
  const empty = mkdtempSync(join(tmpdir(), "recall-empty-"));
  const r = recallIndex(true, { configDir: empty, dbPath: join(empty, "recall.db") });
  expect(r).toEqual({ changed: 0, seen: 0 });
  rmSync(empty, { recursive: true, force: true });
});

test("full reindex does not duplicate", () => {
  recallIndex(true, opts);
  recallIndex(true, opts);
  const rows = recallSearch("zorblax", 20, undefined, opts);
  expect(rows.length).toBe(3); // one hit per chunk (seq 0,1,5), not doubled
});

test("bm25 ranks denser match first", () => {
  const dense = "dddd0000-0000-0000-0000-000000000000";
  writeFileSync(
    join(proj, `${dense}.jsonl`),
    JSON.stringify({
      type: "user",
      timestamp: "2026-06-04T10:00:00.000Z",
      message: { content: "kumquat kumquat kumquat kumquat" },
    }) + "\n",
  );
  writeFileSync(
    join(proj, "eeee0000-0000-0000-0000-000000000000.jsonl"),
    JSON.stringify({
      type: "user",
      timestamp: "2026-06-04T11:00:00.000Z",
      message: { content: "a long note that mentions kumquat once among many other words here" },
    }) + "\n",
  );
  recallIndex(true, opts);
  const rows = recallSearch("kumquat", 8, undefined, opts);
  expect(rows[0].session).toBe(dense);
});
