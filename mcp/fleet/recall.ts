/**
 * recall — FTS5 full-text search over Claude Code session transcripts.
 *
 * A faithful TypeScript port of reclaude's ccrecall.py, using bun:sqlite
 * (which ships FTS5/bm25/snippet). Indexes ~/.claude/projects/<proj>/*.jsonl
 * transcripts into an FTS5 index and exposes incremental index + BM25 search +
 * context scroll + session listing. The fleet MCP's `recall` tool calls
 * recallSearch(), which incrementally indexes first so the index self-freshens
 * on every read — no SessionEnd hook or cron needed.
 *
 * Top-level session files only (`projects/<proj>/<id>.jsonl`); subagent
 * transcripts in `<id>/subagents/` are skipped to keep the index high-signal.
 */
import { Database } from "bun:sqlite";
import { readdirSync, statSync, readFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";

const MAX_CHUNK = 2000; // chars per indexed chunk
const TOOL_RESULT_CAP = 1500; // cap per tool-result block

export type RecallPaths = { configDir?: string; dbPath?: string };

function resolvePaths(opts?: RecallPaths) {
  const config =
    opts?.configDir ?? process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude");
  const projects = join(config, "projects");
  const dbPath = opts?.dbPath ?? process.env.CCRECALL_DB ?? join(config, "recall.db");
  return { config, projects, dbPath };
}

function openDb(dbPath: string): Database {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.run("PRAGMA journal_mode=WAL");
  db.run(`CREATE TABLE IF NOT EXISTS files(
    path TEXT PRIMARY KEY, mtime REAL, size INTEGER, session TEXT, project TEXT
  )`);
  db.run(`CREATE VIRTUAL TABLE IF NOT EXISTS msgs USING fts5(
    text, session UNINDEXED, project UNINDEXED, ts UNINDEXED,
    role UNINDEXED, seq UNINDEXED, tokenize='porter unicode61'
  )`);
  return db;
}

/** Yield [role, text] pieces from one parsed transcript JSONL entry. */
function extractTexts(entry: any): [string, string][] {
  const out: [string, string][] = [];
  const t = entry?.type;
  const msg = entry?.message ?? {};
  if (t === "user") {
    const c = msg.content;
    if (typeof c === "string") {
      out.push(["user", c]);
    } else if (Array.isArray(c)) {
      for (const b of c) {
        if (!b || typeof b !== "object") continue;
        if (b.type === "text") {
          out.push(["user", b.text ?? ""]);
        } else if (b.type === "tool_result") {
          const tc = b.content;
          if (typeof tc === "string") {
            out.push(["tool", tc.slice(0, TOOL_RESULT_CAP)]);
          } else if (Array.isArray(tc)) {
            for (const tb of tc) {
              if (tb && typeof tb === "object" && tb.type === "text") {
                out.push(["tool", (tb.text ?? "").slice(0, TOOL_RESULT_CAP)]);
              }
            }
          }
        }
      }
    }
  } else if (t === "assistant") {
    for (const b of msg.content ?? []) {
      if (b && typeof b === "object" && b.type === "text") {
        out.push(["assistant", b.text ?? ""]);
      }
    }
  }
  return out;
}

function indexFile(db: Database, path: string, project: string) {
  const session = basenameNoExt(path);
  const st = statSync(path);
  // Re-index: drop prior rows for this session, but skip the DELETE for
  // never-before-seen sessions (DELETE on an UNINDEXED fts5 col scans the
  // whole table — wasteful during a fresh full build).
  const seen = db.query("SELECT 1 FROM files WHERE session=? LIMIT 1").get(session);
  if (seen) db.run("DELETE FROM msgs WHERE session=?", [session]);

  const insert = db.prepare(
    "INSERT INTO msgs(text, session, project, ts, role, seq) VALUES(?,?,?,?,?,?)",
  );
  let seq = 0;
  const text = readFileSync(path, "utf8");
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    let entry: any;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const ts = entry.timestamp ?? "";
    for (const [role, txt0] of extractTexts(entry)) {
      const txt = (txt0 ?? "").trim();
      if (txt.length < 3) continue;
      for (let i = 0; i < txt.length; i += MAX_CHUNK) {
        insert.run(txt.slice(i, i + MAX_CHUNK), session, project, ts, role, seq);
      }
      seq += 1;
    }
  }
  db.run("INSERT OR REPLACE INTO files VALUES(?,?,?,?,?)", [
    path,
    st.mtimeMs,
    st.size,
    session,
    project,
  ]);
}

function basenameNoExt(p: string): string {
  const base = p.slice(p.lastIndexOf("/") + 1);
  return base.endsWith(".jsonl") ? base.slice(0, -6) : base;
}

/** Top-level `projects/<proj>/<id>.jsonl` files only (no subagents/ depth). */
function transcriptFiles(projectsDir: string): { path: string; project: string }[] {
  const result: { path: string; project: string }[] = [];
  let projDirs: string[];
  try {
    projDirs = readdirSync(projectsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return result; // missing projects dir is not fatal
  }
  for (const proj of projDirs.sort()) {
    const dir = join(projectsDir, proj);
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (e.isFile() && e.name.endsWith(".jsonl")) {
        result.push({ path: join(dir, e.name), project: proj });
      }
    }
  }
  return result.sort((a, b) => a.path.localeCompare(b.path));
}

export function recallIndex(
  full = false,
  opts?: RecallPaths,
): { changed: number; seen: number } {
  const { projects, dbPath } = resolvePaths(opts);
  const db = openDb(dbPath);
  try {
    const known = new Map<string, [number, number]>();
    for (const r of db.query("SELECT path, mtime, size FROM files").all() as any[]) {
      known.set(r.path, [r.mtime, r.size]);
    }
    let seen = 0;
    let changed = 0;
    db.run("BEGIN");
    for (const { path, project } of transcriptFiles(projects)) {
      seen += 1;
      let st;
      try {
        st = statSync(path);
      } catch {
        continue;
      }
      const prev = known.get(path);
      if (!full && prev && prev[0] === st.mtimeMs && prev[1] === st.size) continue;
      try {
        indexFile(db, path, project);
      } catch {
        continue;
      }
      changed += 1;
    }
    db.run("COMMIT");
    return { changed, seen };
  } finally {
    db.close();
  }
}

export type SearchRow = {
  session: string;
  project: string;
  ts: string;
  role: string;
  seq: string;
  snippet: string;
};

/** Quote each whitespace token so FTS5 stops parsing its query syntax. */
function quotedQuery(raw: string): string {
  return raw
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => `"${t.replace(/"/g, '""')}"`)
    .join(" ");
}

export function recallSearch(
  query: string,
  n = 8,
  project?: string,
  opts?: RecallPaths,
): SearchRow[] {
  const { dbPath } = resolvePaths(opts);
  const db = openDb(dbPath);
  try {
    let sql =
      "SELECT session, project, ts, role, seq," +
      " snippet(msgs, 0, '>>>', '<<<', ' … ', 24) AS snippet" +
      " FROM msgs WHERE msgs MATCH ? ";
    const params: any[] = [query];
    if (project) {
      sql += "AND project LIKE ? ";
      params.push(`%${project}%`);
    }
    sql += "ORDER BY bm25(msgs) LIMIT ?";
    params.push(n);
    const run = (ps: any[]) => db.query(sql).all(...ps) as any[];
    try {
      return run(params);
    } catch {
      params[0] = quotedQuery(query);
      return run(params); // may throw again on a truly broken query — caller handles
    }
  } finally {
    db.close();
  }
}

export type ContextRow = { ts: string; role: string; seq: string; text: string };

export function recallContext(
  session: string,
  seq: number,
  k = 6,
  opts?: RecallPaths,
): ContextRow[] {
  const { dbPath } = resolvePaths(opts);
  const db = openDb(dbPath);
  try {
    return db
      .query(
        "SELECT ts, role, seq, text FROM msgs" +
          " WHERE session=? AND CAST(seq AS INTEGER) BETWEEN ? AND ?" +
          " ORDER BY CAST(seq AS INTEGER), rowid",
      )
      .all(session, seq - k, seq + k) as any[];
  } finally {
    db.close();
  }
}

export type SessionRow = {
  session: string;
  project: string;
  first: string;
  last: string;
  chunks: number;
};

export function recallSessions(n = 20, opts?: RecallPaths): SessionRow[] {
  const { dbPath } = resolvePaths(opts);
  const db = openDb(dbPath);
  try {
    return db
      .query(
        "SELECT session, project, MIN(ts) AS first, MAX(ts) AS last," +
          " COUNT(*) AS chunks FROM msgs GROUP BY session ORDER BY MAX(ts) DESC LIMIT ?",
      )
      .all(n) as any[];
  } finally {
    db.close();
  }
}

// --- text formatters for the MCP tool output -------------------------------

export function formatSearch(rows: SearchRow[]): string {
  if (rows.length === 0)
    return "no matches — try broader/fewer keywords (the index self-refreshes each call)";
  return rows
    .map(
      (r) =>
        `[${(r.ts || "").slice(0, 16)}] ${r.project} (${r.role}) session=${r.session} seq=${r.seq}\n  ${r.snippet}`,
    )
    .join("\n\n");
}

export function formatContext(rows: ContextRow[]): string {
  if (rows.length === 0) return "no entries in that range";
  return rows
    .map((r) => `--- [${(r.ts || "").slice(0, 16)}] ${r.role} (seq ${r.seq}) ---\n${r.text}`)
    .join("\n\n");
}

export function formatSessions(rows: SessionRow[]): string {
  if (rows.length === 0) return "no indexed sessions yet";
  return rows
    .map(
      (r) =>
        `${(r.last || "").slice(0, 16)}  ${r.project}  ${r.session}  (${r.chunks} chunks, started ${(r.first || "").slice(0, 16)})`,
    )
    .join("\n");
}
