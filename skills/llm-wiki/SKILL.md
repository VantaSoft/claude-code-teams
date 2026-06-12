---
name: llm-wiki
description: Contribute durable knowledge to the shared llm-wiki second brain. Use when a session produces knowledge that outlives the current project — a concept finally understood, a reusable architecture decision, a cross-project lesson, a comparison/evaluation of tools, or research findings worth keeping. Also use when the user says "add this to the wiki", "second brain", or "llm-wiki". Do NOT use for project-specific operational facts (those go to auto memory) or in-flight task state (that goes to .claude/active-task.md).
---

# llm-wiki — second brain contributions

Vault location: {{VAULT_PATH}}

## Routing rule (three destinations, never duplicate across them)

1. **Auto memory** (per-agent MEMORY.md + topic files): operational facts about
   THIS project — build commands, conventions, env quirks, workarounds.
2. **llm-wiki** (this skill): knowledge that transcends any one project —
   concepts, mental models, tool evaluations, architecture patterns, distilled
   research, lessons that would help on a future unrelated project.
3. **.claude/active-task.md**: ephemeral working state. Never wiki material.

Test: "Would this page still be useful if the current repo were deleted?"
Yes → wiki. No → auto memory.

## Page conventions

- One concept per page. Filename is the concept in Title Case, e.g.
  `Durable Objects Concurrency Model.md`.
- Before creating, SEARCH the vault (grep/glob the directory) for an existing
  page on the topic. Update and densify existing pages; never create
  near-duplicates.
- Open with a 1-3 sentence definition/summary, then the substance. Dense and
  factual, no narrative filler, no session play-by-play.
- Link related pages with [[wikilinks]] wherever a concept is mentioned that
  has (or deserves) its own page. Backlinks are the point of the vault.
- Add YAML frontmatter: `created`, `updated`, `tags` (lowercase, kebab-case),
  and `source: claude-code` so wiki entries written by Claude are auditable.
- When updating an existing page, integrate — rewrite the relevant section
  rather than appending a dated addendum, and bump `updated`.

## When to invoke during a session

Opportunistically, at natural pauses (task completed, decision finalized,
research concluded) — not mid-implementation. One good page beats five thin
ones; most sessions produce zero wiki entries, and that is correct.
