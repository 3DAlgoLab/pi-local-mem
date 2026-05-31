/**
 * LocalMem configuration resolver.
 *
 * Reads from global ~/.pi/agent/settings.json and project .pi/settings.json.
 * Environment variables override file values.
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export interface LocalMemConfig {
  enabled: boolean;
  maxSizeKb: number;
  maxAgeDays: number;
  sections: string[];
  autoInit: boolean;
  injectContext: boolean;
  memFile: string;
  projectRoot: string;
}

const DEFAULT_SECTIONS = [
  "Decisions",
  "Active Context",
  "Bugs & Fixes",
  "Changelog",
  "Patterns",
];

const SECTIONS_WITH_DATES = new Set(["Decisions", "Bugs & Fixes", "Changelog"]);
const SECTIONS_THAT_AGE = new Set(["Changelog", "Bugs & Fixes"]);

const DEFAULT_CONFIG: Omit<LocalMemConfig, "memFile" | "projectRoot"> = {
  enabled: true,
  maxSizeKb: 8,
  maxAgeDays: 90,
  sections: DEFAULT_SECTIONS,
  autoInit: true,
  injectContext: true,
};

// Centralized accessors so section categorization lives in one place
export function sectionGetsDate(section: string): boolean {
  return SECTIONS_WITH_DATES.has(section);
}

export function sectionAgesOut(section: string): boolean {
  return SECTIONS_THAT_AGE.has(section);
}

function loadJsonFile(filePath: string): Record<string, unknown> {
  if (!existsSync(filePath)) return {};
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf-8"));
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch {
    return {};
  }
}

/**
 * Return the cwd as the project root.
 */
export function findProjectRoot(cwd: string): string {
  return cwd;
}

/**
 * Resolve merged config from global + project settings.
 */
export function resolveConfig(cwd: string): LocalMemConfig {
  const globalSettingsPath = join(homedir(), ".pi", "agent", "settings.json");
  const projectRoot = findProjectRoot(cwd);
  const localSettingsPath = join(projectRoot, ".pi", "settings.json");

  const globalSettings = loadJsonFile(globalSettingsPath);
  const localSettings = loadJsonFile(localSettingsPath);

  const globalMem = (globalSettings.localMem ?? {}) as Record<string, unknown>;
  const localMem = (localSettings.localMem ?? {}) as Record<string, unknown>;

  const merged = { ...DEFAULT_CONFIG };

  for (const source of [globalMem, localMem]) {
    if (typeof source.enabled === "boolean") merged.enabled = source.enabled;
    if (typeof source.maxSizeKb === "number" && source.maxSizeKb > 0) merged.maxSizeKb = source.maxSizeKb;
    if (typeof source.maxAgeDays === "number" && source.maxAgeDays > 0) merged.maxAgeDays = source.maxAgeDays;
    if (Array.isArray(source.sections) && source.sections.length > 0 && source.sections.every((s): s is string => typeof s === "string")) {
      merged.sections = source.sections;
    }
    if (typeof source.autoInit === "boolean") merged.autoInit = source.autoInit;
    if (typeof source.injectContext === "boolean") merged.injectContext = source.injectContext;
  }

  // Environment overrides
  const envEnabled = process.env.LOCALMEM_ENABLED?.toLowerCase();
  if (envEnabled === "0" || envEnabled === "false" || envEnabled === "no") {
    merged.enabled = false;
  } else if (envEnabled === "1" || envEnabled === "true" || envEnabled === "yes") {
    merged.enabled = true;
  }
  if (process.env.LOCALMEM_MAX_SIZE_KB) {
    const n = parseInt(process.env.LOCALMEM_MAX_SIZE_KB, 10);
    if (n > 0) merged.maxSizeKb = n;
  }

  return {
    ...merged,
    memFile: join(projectRoot, "LocalMem.md"),
    projectRoot,
  };
}
