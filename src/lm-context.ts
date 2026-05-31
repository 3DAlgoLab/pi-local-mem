/**
 * Context injection builder for LocalMem.md.
 *
 * Reads the LocalMem.md content and formats it for injection into the agent's
 * system prompt. Accepts pre-computed stats to avoid redundant file reads.
 */

import type { LocalMemConfig } from "./lm-config.js";
import { readMem } from "./lm-file.js";
import type { LmStats } from "./lm-file.js";

const CONTEXT_INSTRUCTIONS = `
## LocalMem — Project Memory

You have access to a project memory file (LocalMem.md) loaded below. Use the localmem_write tool to persist important information.

Sections:
- **Decisions** — architecture choices, tool selections, key design decisions
- **Active Context** — current project state, constraints, in-effect configurations
- **Bugs & Fixes** — bugs encountered and how they were resolved
- **Changelog** — notable changes made to the project
- **Patterns** — recurring conventions, gotchas, project-specific rules

When to write (call localmem_write):
- User says "remember this", "note this", "save this", or similar
- After making a non-obvious architectural or tool decision — persist it to Decisions
- After resolving a tricky bug — persist to Bugs & Fixes
- After making a notable project change — persist to Changelog
- When the user establishes a convention or reveals a project-specific gotcha — persist to Patterns
- When updating active project context (constraints, configurations) — persist to Active Context

Rules:
- Keep entries concise — one fact per line, no paragraphs
- Dates are auto-prepended for Decisions, Bugs & Fixes, and Changelog
- Use localmem_clean when the file grows large or accumulates stale entries
- LocalMem.md is gitignored — it stays local to the project
`.trim();

/**
 * Build the context block to inject into the system prompt.
 * Accepts stats to avoid re-reading the file.
 */
export function buildContextBlock(config: LocalMemConfig, stats: LmStats): string {
  if (!stats.fileExists || stats.totalEntries === 0) return "";

  const content = readMem(config.memFile);
  if (!content) return "";

  // Strip the "# Project Memory" header line
  const body = content.trim().startsWith("# Project Memory")
    ? content.trim().split("\n").slice(1).join("\n").trim()
    : content.trim();

  const lines = [
    CONTEXT_INSTRUCTIONS,
    "",
    `<localmem>`,
    body,
    `</localmem>`,
    "",
    `LocalMem stats: ${stats.totalEntries} entries across ${stats.sections.length} sections, ${stats.fileSizeKb}KB`,
  ];

  const maxBytes = config.maxSizeKb * 1024;
  const full = lines.join("\n");
  if (Buffer.byteLength(full, "utf-8") <= maxBytes) return full;

  // File too large — truncate with binary search for efficiency
  return buildTruncated(config, content.trim(), maxBytes);
}

function buildTruncated(config: LocalMemConfig, content: string, maxBytes: number): string {
  const overhead = Buffer.byteLength(
    `${CONTEXT_INSTRUCTIONS}\n\n<localmem>\n\n</localmem>\n... (truncated — use localmem_clean to reduce)`,
    "utf-8",
  );
  const availableBytes = maxBytes - overhead;
  if (availableBytes <= 0) return CONTEXT_INSTRUCTIONS;

  // Binary search for the right truncation point
  let lo = 0;
  let hi = content.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (Buffer.byteLength(content.slice(0, mid), "utf-8") <= availableBytes) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  const truncated = content.slice(0, lo) + "\n... (truncated — use localmem_clean to reduce)";

  return [
    CONTEXT_INSTRUCTIONS,
    "",
    `<localmem>`,
    truncated,
    `</localmem>`,
  ].join("\n");
}

/**
 * Build a shorter context block for when LocalMem.md is very large.
 * Only injects stats and a pointer to use localmem_read.
 */
export function buildLightweightContext(stats: LmStats): string {
  if (!stats.fileExists) return "";

  return [
    `LocalMem: ${stats.totalEntries} entries across ${stats.sections.length} sections (${stats.fileSizeKb}KB).`,
    `Use localmem_read to access specific sections. Use localmem_search to find entries.`,
  ].join(" ");
}
