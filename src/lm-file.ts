/**
 * LocalMem.md file operations: create, read, append, clean, search.
 *
 * The LocalMem.md format uses markdown sections with dated/undated entries.
 * This module handles all file I/O with zero external dependencies.
 */

import {
  readFileSync,
  writeFileSync,
  existsSync,
  appendFileSync,
  mkdirSync,
  statSync,
} from "node:fs";
import { join, dirname } from "node:path";
import type { LocalMemConfig } from "./lm-config.js";
import { sectionGetsDate, sectionAgesOut } from "./lm-config.js";

// ─── Types ──────────────────────────────────────────────────────────────

export interface LmEntry {
  section: string;
  text: string;
  date?: string;
}

export interface LmStats {
  fileExists: boolean;
  fileSizeKb: number;
  totalEntries: number;
  entriesBySection: Record<string, number>;
  lastModified: string;
  sections: string[];
}

export interface CleanPlan {
  duplicates: LmEntry[];
  stale: LmEntry[];
  oversized: boolean;
  totalBefore: number;
  totalAfter: number;
}

// ─── Constants ──────────────────────────────────────────────────────────

const HEADER = "# Project Memory";
const DATE_PREFIX_RE = /^[-*] (\d{4}-\d{2}-\d{2}): /;
const BULLET_RE = /^[-*] (.+)$/;
const SECTION_RE = /^## (.+)$/;

// ─── File Operations ────────────────────────────────────────────────────

export function createMem(filePath: string, sections: string[]): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const lines: string[] = [HEADER, ""];
  for (const section of sections) {
    lines.push(`## ${section}`, "", "");
  }
  lines.push("");
  writeFileSync(filePath, lines.join("\n"), "utf-8");
}

export function readMem(filePath: string): string | null {
  if (!existsSync(filePath)) return null;
  try {
    return readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
}

export function writeMem(filePath: string, content: string): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(filePath, content, "utf-8");
}

// ─── Parsing ────────────────────────────────────────────────────────────

export function parseMem(content: string): Map<string, LmEntry[]> {
  const sections = new Map<string, LmEntry[]>();
  let currentSection = "";
  let currentEntries: LmEntry[] = [];

  for (const line of content.split("\n")) {
    const sectionMatch = line.match(SECTION_RE);
    if (sectionMatch) {
      if (currentSection) {
        const existing = sections.get(currentSection) ?? [];
        sections.set(currentSection, [...existing, ...currentEntries]);
      }
      currentSection = sectionMatch[1].trim();
      currentEntries = [];
      continue;
    }

    if (!currentSection || line.trim() === "") continue;

    const dateMatch = line.match(DATE_PREFIX_RE);
    const bulletMatch = line.match(BULLET_RE);

    if (dateMatch) {
      const datePart = dateMatch[1];
      const textPart = line.slice(dateMatch[0].length).trim();
      if (textPart.length > 0) {
        currentEntries.push({ section: currentSection, text: textPart, date: datePart });
      }
    } else if (bulletMatch) {
      const bulletText = bulletMatch[1].trim();
      if (bulletText.length > 0) {
        currentEntries.push({ section: currentSection, text: bulletText });
      }
    }
  }

  if (currentSection) {
    const existing = sections.get(currentSection) ?? [];
    sections.set(currentSection, [...existing, ...currentEntries]);
  }

  return sections;
}

export function serializeMem(sections: Map<string, LmEntry[]>, orderedSections: string[]): string {
  const lines: string[] = [HEADER, ""];
  const seen = new Set<string>();

  for (const section of orderedSections) {
    seen.add(section);
    lines.push(`## ${section}`, "");
    const entries = sections.get(section) ?? [];
    for (const entry of entries) {
      lines.push(entry.date ? `- ${entry.date}: ${entry.text}` : `- ${entry.text}`);
    }
    lines.push("");
  }

  for (const [section, entries] of sections) {
    if (seen.has(section)) continue;
    lines.push(`## ${section}`, "");
    for (const entry of entries) {
      lines.push(entry.date ? `- ${entry.date}: ${entry.text}` : `- ${entry.text}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

// ─── Entry Operations ───────────────────────────────────────────────────

export function appendEntries(
  filePath: string,
  section: string,
  texts: string[],
  config: LocalMemConfig,
): number {
  const today = new Date().toISOString().slice(0, 10);
  const shouldDate = sectionGetsDate(section);

  let content = readMem(filePath);
  if (!content) {
    createMem(filePath, config.sections);
    content = readMem(filePath);
    if (!content) throw new Error("Failed to read LocalMem.md after creation");
  }

  const parsed = parseMem(content);
  const existing = parsed.get(section) ?? [];

  // Dedup: build set of normalized existing texts
  const seenTexts = new Set(existing.map(e => e.text.toLowerCase().trim()));
  const newEntries: LmEntry[] = [];

  for (const text of texts) {
    const normalized = text.toLowerCase().trim();
    if (!seenTexts.has(normalized)) {
      seenTexts.add(normalized);
      newEntries.push({ section, text, date: shouldDate ? today : undefined });
    }
  }

  if (newEntries.length === 0) return 0;

  parsed.set(section, [...existing, ...newEntries]);
  writeMem(filePath, serializeMem(parsed, config.sections));
  return newEntries.length;
}

export function overwriteSection(
  filePath: string,
  section: string,
  text: string,
  config: LocalMemConfig,
): void {
  let content = readMem(filePath);
  if (!content) {
    createMem(filePath, config.sections);
    content = readMem(filePath);
    if (!content) throw new Error("Failed to read LocalMem.md after creation");
  }

  const parsed = parseMem(content);
  const lines = text.split("\n").filter(l => l.trim());
  const entries: LmEntry[] = lines.map(line => {
    const dateMatch = line.match(DATE_PREFIX_RE);
    if (dateMatch) {
      return { section, text: line.slice(dateMatch[0].length).trim(), date: dateMatch[1] };
    }
    const bareDateMatch = line.match(/^(\d{4}-\d{2}-\d{2}): (.+)$/);
    if (bareDateMatch) {
      return { section, text: bareDateMatch[2].trim(), date: bareDateMatch[1] };
    }
    return { section, text: line.replace(/^[-*]\s*/, "").trim() };
  });

  parsed.set(section, entries);
  writeMem(filePath, serializeMem(parsed, config.sections));
}

export function readSection(filePath: string, section: string): string | null {
  const content = readMem(filePath);
  if (!content) return null;

  const parsed = parseMem(content);
  const entries = parsed.get(section);
  if (!entries || entries.length === 0) return null;

  return entries
    .map(e => (e.date ? `- ${e.date}: ${e.text}` : `- ${e.text}`))
    .join("\n");
}

// ─── Search ─────────────────────────────────────────────────────────────

export function searchMem(filePath: string, query: string, sectionFilter?: string): LmEntry[] {
  const content = readMem(filePath);
  if (!content) return [];

  const parsed = parseMem(content);
  const needle = query.toLowerCase();
  const results: LmEntry[] = [];

  for (const [sec, entries] of parsed) {
    if (sectionFilter && sec !== sectionFilter) continue;
    for (const entry of entries) {
      if (entry.text.toLowerCase().includes(needle) || (entry.date && entry.date.toLowerCase().includes(needle))) {
        results.push(entry);
      }
    }
  }

  return results;
}

// ─── Stats ──────────────────────────────────────────────────────────────

export function getStats(filePath: string): LmStats {
  const content = readMem(filePath);

  if (!content) {
    return {
      fileExists: false,
      fileSizeKb: 0,
      totalEntries: 0,
      entriesBySection: {},
      lastModified: "",
      sections: [],
    };
  }

  const parsed = parseMem(content);
  const entriesBySection: Record<string, number> = {};
  let totalEntries = 0;

  for (const [section, entries] of parsed) {
    entriesBySection[section] = entries.length;
    totalEntries += entries.length;
  }

  let fileSizeKb = 0;
  let lastModified = "";
  try {
    const stat = statSync(filePath);
    fileSizeKb = Math.round(stat.size / 1024 * 10) / 10;
    lastModified = stat.mtime.toISOString().slice(0, 10);
  } catch {}

  return {
    fileExists: true,
    fileSizeKb,
    totalEntries,
    entriesBySection,
    lastModified,
    sections: [...parsed.keys()],
  };
}

// ─── Clean ─────────────────────────────────────────────────────────────

export function computeCleanPlan(
  filePath: string,
  config: LocalMemConfig,
  maxAgeDays?: number,
): CleanPlan {
  const content = readMem(filePath);
  if (!content) {
    return { duplicates: [], stale: [], oversized: false, totalBefore: 0, totalAfter: 0 };
  }

  const parsed = parseMem(content);
  const ageLimit = maxAgeDays ?? config.maxAgeDays;
  const enableStaleness = Number.isFinite(ageLimit) && ageLimit > 0;
  let cutoffStr: string | undefined;
  if (enableStaleness) {
    const staleCutoff = new Date(Date.now() - ageLimit * 24 * 60 * 60 * 1000);
    cutoffStr = staleCutoff.toISOString().slice(0, 10);
  }

  const duplicates: LmEntry[] = [];
  const stale: LmEntry[] = [];
  let totalBefore = 0;
  let totalAfter = 0;

  for (const [section, entries] of parsed) {
    const kept: LmEntry[] = [];
    const seenTexts = new Set<string>();

    for (const entry of entries) {
      totalBefore++;

      if (enableStaleness && sectionAgesOut(section) && entry.date && entry.date < cutoffStr!) {
        stale.push(entry);
        continue;
      }

      const normalized = entry.text.toLowerCase().trim();
      if (seenTexts.has(normalized)) {
        duplicates.push(entry);
        continue;
      }
      seenTexts.add(normalized);
      kept.push(entry);
    }

    totalAfter += kept.length;
  }

  const stat = existsSync(filePath) ? statSync(filePath) : null;
  const oversized = stat ? stat.size > config.maxSizeKb * 1024 : false;

  return { duplicates, stale, oversized, totalBefore, totalAfter };
}

export function executeClean(filePath: string, config: LocalMemConfig, plan: CleanPlan): void {
  if (plan.totalBefore === 0) return;

  const content = readMem(filePath);
  if (!content) return;

  const parsed = parseMem(content);

  const removeCounts = new Map<string, number>();
  for (const entry of [...plan.duplicates, ...plan.stale]) {
    const key = `${entry.section}\0${entry.date ?? ""}\0${entry.text}`;
    removeCounts.set(key, (removeCounts.get(key) ?? 0) + 1);
  }

  const cleaned: Map<string, LmEntry[]> = new Map();

  for (const [section, entries] of parsed) {
    const kept: LmEntry[] = [];
    for (const entry of entries) {
      const key = `${entry.section}\0${entry.date ?? ""}\0${entry.text}`;
      const count = removeCounts.get(key) ?? 0;
      if (count > 0) {
        removeCounts.set(key, count - 1);
        continue;
      }
      kept.push(entry);
    }
    cleaned.set(section, kept);
  }

  writeMem(filePath, serializeMem(cleaned, config.sections));
}

export function ensureGitignore(projectRoot: string): boolean {
  const gitignorePath = join(projectRoot, ".gitignore");
  if (!existsSync(join(projectRoot, ".git"))) return false;

  let gitignoreContent = "";
  if (existsSync(gitignorePath)) {
    gitignoreContent = readFileSync(gitignorePath, "utf-8");
  }

  if (gitignoreContent.split("\n").some(line => {
    const trimmed = line.trim();
    return trimmed === "LocalMem.md" || trimmed === "/LocalMem.md" || trimmed.includes("LocalMem.md");
  })) {
    return false;
  }

  const addition = (gitignoreContent.endsWith("\n") || gitignoreContent === "")
    ? "LocalMem.md\n"
    : "\nLocalMem.md\n";

  appendFileSync(gitignorePath, addition, "utf-8");
  return true;
}
