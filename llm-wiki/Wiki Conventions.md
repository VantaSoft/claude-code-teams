---
created: 2026-06-11
updated: 2026-06-11
tags: [meta]
source: claude-code
---

# Wiki Conventions

Rules for every page in this vault, whether written by Claude or by hand.

- **One concept per page.** Filename is the concept in Title Case
  (`Durable Objects Concurrency Model.md`).
- **Update, don't duplicate.** Search the vault before creating a page;
  densify the existing page instead of writing a near-duplicate. Integrate
  edits into the relevant section — no dated addenda — and bump `updated`.
- **Dense and factual.** Open with a 1-3 sentence definition, then substance.
  No narrative filler, no session play-by-play.
- **Backlink liberally.** Use wikilinks (`[[Page Name]]`) wherever a concept with (or deserving) its own page is mentioned. The graph is the point.
- **Frontmatter:** `created`, `updated`, `tags` (lowercase, kebab-case), and
  `source: claude-code` for entries written by Claude, so they are auditable.
- **Scope test:** "Would this page still be useful if the current repo were
  deleted?" If no, it belongs in that project's auto memory, not here.
