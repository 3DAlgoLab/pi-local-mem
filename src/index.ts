/**
 * pi-local-mem — Project-level session memory for the pi coding agent.
 *
 * Stores memory in a single LocalMem.md file at the project root.
 * Injects context into every session. Provides tools for reading,
 * writing, searching, and cleaning the memory file.
 *
 * Zero dependencies beyond pi-coding-agent and typebox.
 * No LLM calls. No SQLite. No git dependency.
 *
 * Events:
 * - session_start: read LocalMem.md, ensure .gitignore, show status
 * - before_agent_start: inject LocalMem.md context into system prompt
 * - session_before_compact: notify user that context is persisted
 *
 * Tools:
 * - localmem_write: append or overwrite a section
 * - localmem_read: read entire file or specific section
 * - localmem_search: search by keyword
 * - localmem_clean: remove duplicates and stale entries
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { resolveConfig, type LocalMemConfig } from "./lm-config.js";
import { readMem, createMem, ensureGitignore, getStats, type LmStats } from "./lm-file.js";
import { buildContextBlock, buildLightweightContext } from "./lm-context.js";
import { registerLocalMemTools } from "./lm-tools.js";

export default function (pi: ExtensionAPI) {
  let config: LocalMemConfig | null = null;
  let memdExists = false;

  function getConfig(): LocalMemConfig {
    if (!config) throw new Error("LocalMem config not initialized");
    return config;
  }

  // ─── Register tools ─────────────────────────────────────────────────

  registerLocalMemTools(pi, getConfig);

  // ─── session_start ──────────────────────────────────────────────────

  pi.on("session_start", async (_event, ctx) => {
    config = resolveConfig(ctx.cwd);
    memdExists = Boolean(readMem(config.memFile));

    // Auto-init if LocalMem.md doesn't exist and autoInit is enabled
    if (!memdExists && config.autoInit) {
      createMem(config.memFile, config.sections);
      const added = ensureGitignore(config.projectRoot);
      memdExists = true;

      const gitMsg = added ? " (added to .gitignore)" : "";
      ctx.ui.notify(`LocalMem.md initialized${gitMsg}`, "info");
    }

    // Show status bar
    if (memdExists) {
      const stats = getStats(config.memFile);
      ctx.ui.setStatus("localmem", `LocalMem: ${stats.totalEntries} entries`);
      setTimeout(() => ctx.ui.setStatus("localmem", undefined), 5000);
    }
  });

  // ─── before_agent_start ─────────────────────────────────────────────

  pi.on("before_agent_start", async (event, _ctx) => {
    if (!config?.enabled || !config.injectContext) return;

    // Single file read — stats computed once, passed to builder
    const stats = getStats(config.memFile);
    const maxSizeBytes = config.maxSizeKb * 1024;

    if (stats.fileSizeKb * 1024 > maxSizeBytes * 1.5) {
      const lightweight = buildLightweightContext(stats);
      if (lightweight) {
        return { systemPrompt: event.systemPrompt + "\n\n" + lightweight };
      }
      return;
    }

    const contextBlock = buildContextBlock(config, stats);
    if (!contextBlock) return;

    return { systemPrompt: event.systemPrompt + "\n\n" + contextBlock };
  });

  // ─── session_before_compact ─────────────────────────────────────────

  pi.on("session_before_compact", async (_event, ctx) => {
    if (!config?.enabled) return;
    // Use cached existence flag instead of re-reading the file
    if (memdExists) {
      ctx.ui.notify("LocalMem.md has content — important context is persisted there before compaction", "info");
    }
  });
}
