#!/usr/bin/env bun
/**
 * reclaude-steer — SessionStart post-compaction recovery hook.
 *
 * On SessionStart with matcher "compact", emits recovery instructions as
 * additionalContext so the model re-orients after a compaction (re-read the
 * working-state journal, recover dropped detail via the fleet `recall` tool).
 * Pure static-text emit — it does NOT index, because `recall` self-freshens
 * (incrementally indexes on every search). A hook must never break a session,
 * so this always exits 0 and stays silent on any error.
 *
 * Wired per-agent in .claude/settings.local.json:
 *   SessionStart -> bun <hooks>/reclaude-steer.ts post-compact   (matcher: "compact")
 *
 * NO PreCompact hook: this Claude Code build's hook output schema has no
 * PreCompact variant — additionalContext is only accepted for
 * UserPromptSubmit/PostToolUse/PostToolBatch/Stop, so a PreCompact emit
 * fails validation ("(root): Invalid input") on every compaction with zero
 * benefit. `pre-compact` is therefore a deliberate no-op (kept so any not-yet-
 * restarted agent still wired to it errors harmlessly instead of failing).
 * Continuity is carried by the journal (.claude/active-task.md) + this
 * recovery hook, not by steering the summary.
 *
 * Emits ONLY the documented `hookSpecificOutput: { hookEventName, additionalContext }`
 * shape. A top-level `additionalContext` is rejected by the hook root schema.
 */
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
  // pre-compact: intentionally emits nothing (see header).
  if (sub === "post-compact") emit("SessionStart", POST_COMPACT);
} catch {
  // a hook must never break the session
}
process.exit(0);
