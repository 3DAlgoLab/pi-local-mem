/**
 * LocalMem tools — localmem_write, localmem_read, localmem_search, localmem_clean
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type, type Static } from "@sinclair/typebox";
import type { LocalMemConfig } from "./lm-config.js";
import {
  appendEntries,
  overwriteSection,
  readSection,
  readMem,
  searchMem,
  computeCleanPlan,
  executeClean,
} from "./lm-file.js";

type ToolResult = ReturnType<NonNullable<Parameters<ExtensionAPI["registerTool"]>[0]["execute"]>> extends Promise<infer R> ? R : never;
function ok(text: string): ToolResult {
  return { content: [{ type: "text" as const, text }], details: {} };
}

const WriteParams = Type.Object({
  section: Type.String({ description: "Section name to write to" }),
  content: Type.String({ description: "Entry text. One fact per line for append mode. Full section content for overwrite mode." }),
  mode: Type.Optional(Type.Union([
    Type.Literal("append"),
    Type.Literal("overwrite"),
  ], {
    description: "Write mode: 'append' adds entries (default), 'overwrite' replaces the entire section.",
  })),
});
type WriteInput = Static<typeof WriteParams>;

const ReadParams = Type.Object({
  section: Type.Optional(Type.String({ description: "Section to read. Omit for entire file." })),
});
type ReadInput = Static<typeof ReadParams>;

const SearchParams = Type.Object({
  query: Type.String({ description: "Search query (case-insensitive substring)" }),
  section: Type.Optional(Type.String({ description: "Limit search to this section" })),
});
type SearchInput = Static<typeof SearchParams>;

const CleanParams = Type.Object({
  maxAgeDays: Type.Optional(Type.Number({ description: "Remove entries older than this many days (default: from config)" })),
  dryRun: Type.Optional(Type.Boolean({ description: "Preview changes without writing. Default: false." })),
});
type CleanInput = Static<typeof CleanParams>;

/**
 * Check if a section is valid: either in config sections or already exists in the file.
 */
function isValidSection(section: string, config: LocalMemConfig): boolean {
  if (config.sections.includes(section)) return true;
  // Allow custom sections that already exist in the file
  const content = readMem(config.memFile);
  if (!content) return false;
  return content.includes(`## ${section}`);
}

export function registerLocalMemTools(pi: ExtensionAPI, config: () => LocalMemConfig) {
  // ─── localmem_write ────────────────────────────────────────────────
  pi.registerTool({
    name: "localmem_write",
    label: "LocalMem Write",
    description: [
      "Write to a section of LocalMem.md (project memory).",
      "- 'append': Add new entries (date auto-prepended for dated sections; duplicates are silently skipped)",
      "- 'overwrite': Replace the entire section content",
      "Use when the user asks to remember something, after making decisions, fixing bugs, or noting changes.",
    ].join("\n"),
    parameters: WriteParams,
    async execute(_id, params, _signal, _onUpdate, _ctx) {
      const cfg = config();
      if (!cfg.enabled) throw new Error("LocalMem is disabled in config.");

      if (!isValidSection(params.section, cfg)) {
        throw new Error(`Invalid section "${params.section}". Valid sections: ${cfg.sections.join(", ")} (or create one by editing LocalMem.md directly).`);
      }

      if (params.content.length > cfg.maxSizeKb * 256) {
        throw new Error(`Content too large (${params.content.length} chars, limit ~${cfg.maxSizeKb * 256}). Use localmem_clean to reduce LocalMem.md size.`);
      }

      const mode = params.mode ?? "append";

      if (mode === "overwrite") {
        overwriteSection(cfg.memFile, params.section, params.content, cfg);
        return ok(`Overwrote "${params.section}" section in LocalMem.md`);
      }

      // Append: strip bullet markers and bare dates from user input
      const lines = params.content
        .split("\n")
        .map(l => l.trim())
        .filter(l => l.length > 0)
        .map(l => l.replace(/^[-*]\s*/, "").replace(/^(\d{4}-\d{2}-\d{2}:\s*)/, ""));

      if (lines.length === 0) {
        return ok("No entries to append (empty content).");
      }

      const written = appendEntries(cfg.memFile, params.section, lines, cfg);
      if (written === lines.length) {
        return ok(`Appended ${written} entries to "${params.section}" in LocalMem.md`);
      }
      const skipped = lines.length - written;
      return ok(`Appended ${written} entries to "${params.section}" in LocalMem.md (${skipped} duplicates skipped)`);
    },
  });

  // ─── localmem_read ────────────────────────────────────────────────
  pi.registerTool({
    name: "localmem_read",
    label: "LocalMem Read",
    description: [
      "Read from LocalMem.md (project memory).",
      "- Specify a section name to read just that section",
      "- Omit section to read the entire file",
    ].join("\n"),
    parameters: ReadParams,
    async execute(_id, params, _signal, _onUpdate, _ctx) {
      const cfg = config();
      if (!cfg.enabled) throw new Error("LocalMem is disabled in config.");

      if (params.section && !isValidSection(params.section, cfg)) {
        throw new Error(`Invalid section "${params.section}".`);
      }

      if (params.section) {
        const content = readSection(cfg.memFile, params.section);
        if (!content) return ok(`Section "${params.section}" is empty or doesn't exist in LocalMem.md.`);
        return ok(content);
      }

      const content = readMem(cfg.memFile);
      if (!content) return ok("LocalMem.md doesn't exist yet. Use localmem_write to create entries.");
      return ok(content);
    },
  });

  // ─── localmem_search ──────────────────────────────────────────────
  pi.registerTool({
    name: "localmem_search",
    label: "LocalMem Search",
    description: [
      "Search LocalMem.md entries by keyword (case-insensitive substring match).",
      "Optionally limit to a specific section.",
    ].join("\n"),
    parameters: SearchParams,
    async execute(_id, params, _signal, _onUpdate, _ctx) {
      const cfg = config();
      if (!cfg.enabled) throw new Error("LocalMem is disabled in config.");

      if (params.section && !isValidSection(params.section, cfg)) {
        throw new Error(`Invalid section "${params.section}".`);
      }

      const results = searchMem(cfg.memFile, params.query, params.section);
      if (results.length === 0) {
        return ok(`No entries matching "${params.query}" found in LocalMem.md.`);
      }

      const lines = results.map(e => {
        const dateStr = e.date ? ` [${e.date}]` : "";
        return `- [${e.section}]${dateStr} ${e.text}`;
      });
      return ok(`Found ${results.length} entries:\n${lines.join("\n")}`);
    },
  });

  // ─── localmem_clean ───────────────────────────────────────────────
  pi.registerTool({
    name: "localmem_clean",
    label: "LocalMem Clean",
    description: [
      "Clean LocalMem.md by removing duplicates and stale entries.",
      "- Removes duplicate entries (same text, different dates)",
      "- Prunes Changelog and Bugs & Fixes entries older than maxAgeDays",
      "- dryRun: preview changes without modifying the file",
    ].join("\n"),
    parameters: CleanParams,
    async execute(_id, params, _signal, _onUpdate, _ctx) {
      const cfg = config();
      if (!cfg.enabled) throw new Error("LocalMem is disabled in config.");

      const plan = computeCleanPlan(cfg.memFile, cfg, params.maxAgeDays);

      if (plan.totalBefore === 0) {
        return ok("LocalMem.md is empty or doesn't exist. Nothing to clean.");
      }

      const summary: string[] = [
        `Clean plan for LocalMem.md:`,
        `  Total entries: ${plan.totalBefore} → ${plan.totalAfter}`,
        `  Duplicates to remove: ${plan.duplicates.length}`,
        `  Stale entries to remove: ${plan.stale.length}`,
        `  File is ${plan.oversized ? "OVER" : "within"} size limit (${cfg.maxSizeKb}KB)`,
      ];

      if (plan.duplicates.length > 0) {
        summary.push("", "Duplicates:");
        for (const d of plan.duplicates.slice(0, 10)) {
          summary.push(`  - [${d.section}] ${d.date ? d.date + ": " : ""}${d.text}`);
        }
        if (plan.duplicates.length > 10) {
          summary.push(`  ... and ${plan.duplicates.length - 10} more`);
        }
      }

      if (plan.stale.length > 0) {
        summary.push("", "Stale entries:");
        for (const s of plan.stale.slice(0, 10)) {
          summary.push(`  - [${s.section}] ${s.date}: ${s.text}`);
        }
        if (plan.stale.length > 10) {
          summary.push(`  ... and ${plan.stale.length - 10} more`);
        }
      }

      if (params.dryRun) {
        summary.push("", "(dry run — no changes made)");
        return ok(summary.join("\n"));
      }

      executeClean(cfg.memFile, cfg, plan);
      summary.push("", "LocalMem.md cleaned successfully.");
      return ok(summary.join("\n"));
    },
  });
}
