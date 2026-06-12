#!/usr/bin/env bun
/**
 * reclaude-steer — PreCompact + SessionStart context-steering hooks.
 *
 * Emits context-preservation (PreCompact) and recovery (SessionStart)
 * instructions as additionalContext, so the model keeps verbatim state across
 * a compaction and recovers it afterward. Pure static-text emit — it does NOT
 * index, because the fleet `recall` tool self-freshens (incrementally indexes
 * on every search). A hook must never break a session, so this always exits 0
 * and stays silent on any error.
 *
 * Wired per-agent in .claude/settings.local.json:
 *   PreCompact   -> bun <hooks>/reclaude-steer.ts pre-compact
 *   SessionStart -> bun <hooks>/reclaude-steer.ts post-compact   (matcher: "compact")
 *
 * Emits ONLY the documented `hookSpecificOutput: { hookEventName, additionalContext }`
 * shape. A top-level `additionalContext` is rejected by the hook root schema
 * ("(root): Invalid input") and must not be sent — it breaks PreCompact.
 */
const PRE_COMPACT =
  "When summarizing, preserve verbatim: the current task goal, every " +
  "decision made and the alternatives rejected, exact file paths touched, " +
  "exact commands that worked, and any unresolved errors with their exact " +
  "error messages. Do not generalize these into vague statements.";

const POST_COMPACT =
  "NOTE: context was just compacted. Before continuing: (1) re-read " +
  ".claude/active-task.md if it exists and treat it as the source of truth " +
  "for the in-flight task; (2) re-read any auto-memory topic files relevant " +
  "to that task; (3) if anything you relied on is missing from the summary, " +
  "recover it with the fleet `recall` tool instead of guessing or asking the " +
  "user to repeat themselves.";

function emit(event: string, text: string): void {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: event, additionalContext: text },
    }) + "\n",
  );
}

try {
  const sub = process.argv[2] ?? "";
  if (sub === "pre-compact") emit("PreCompact", PRE_COMPACT);
  else if (sub === "post-compact") emit("SessionStart", POST_COMPACT);
} catch {
  // a hook must never break the session
}
process.exit(0);
