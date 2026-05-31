import { describe, it, before, after } from "node:test";
import { strict as assert } from "node:assert";
import { writeFileSync, unlinkSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { appendEntries, overwriteSection, readSection, searchMem, computeCleanPlan, executeClean, getStats } from "../src/lm-file.js";
import type { LocalMemConfig } from "../src/lm-config.js";

const tmpDir = join(import.meta.dirname ?? "/tmp", ".lm-test");
let fileIdx = 0;

function freshFile(): string {
  return join(tmpDir, `LocalMem-${fileIdx++}.md`);
}

function makeConfig(filePath: string, overrides?: Partial<LocalMemConfig>): LocalMemConfig {
  return {
    enabled: true,
    maxSizeKb: 8,
    maxAgeDays: 90,
    sections: ["Decisions", "Active Context", "Bugs & Fixes", "Changelog", "Patterns"],
    autoInit: true,
    injectContext: true,
    memFile: filePath,
    projectRoot: tmpDir,
    ...overrides,
  };
}

function cleanup(filePath: string) {
  if (existsSync(filePath)) unlinkSync(filePath);
}

before(() => {
  if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });
});

describe("appendEntries", () => {
  it("creates file if missing and appends dated entry", () => {
    const file = freshFile();
    const cfg = makeConfig(file);
    const written = appendEntries(cfg.memFile, "Decisions", ["Using FastAPI for API"], cfg);
    assert.equal(written, 1);

    const section = readSection(cfg.memFile, "Decisions");
    assert.ok(section?.match(/\d{4}-\d{2}-\d{2}:/), "Should have a date prefix");
    assert.ok(section?.includes("Using FastAPI for API"));
    cleanup(file);
  });

  it("deduplicates entries with same text", () => {
    const file = freshFile();
    const cfg = makeConfig(file);
    appendEntries(cfg.memFile, "Decisions", ["Using FastAPI"], cfg);
    const written2 = appendEntries(cfg.memFile, "Decisions", ["using fastapi"], cfg);
    assert.equal(written2, 0, "Duplicate should be skipped");
    cleanup(file);
  });

  it("appends multiple entries in one call", () => {
    const file = freshFile();
    const cfg = makeConfig(file);
    const written = appendEntries(cfg.memFile, "Patterns", [
      "Conventional commits",
      "labnet Docker network",
    ], cfg);
    assert.equal(written, 2);

    const section = readSection(cfg.memFile, "Patterns");
    assert.ok(section?.includes("Conventional commits"));
    assert.ok(section?.includes("labnet Docker network"));
    cleanup(file);
  });

  it("dates Decisions but not Active Context", () => {
    const file = freshFile();
    const cfg = makeConfig(file);
    appendEntries(cfg.memFile, "Decisions", ["Chose PostgreSQL"], cfg);
    appendEntries(cfg.memFile, "Active Context", ["Docker on labnet"], cfg);

    const dec = readSection(cfg.memFile, "Decisions");
    assert.ok(dec?.match(/\d{4}-\d{2}-\d{2}:/), "Decisions should be dated");

    const ctx = readSection(cfg.memFile, "Active Context");
    assert.ok(!ctx?.match(/\d{4}-\d{2}-\d{2}:/), "Active Context should not be dated");
    cleanup(file);
  });
});

describe("overwriteSection", () => {
  it("replaces all entries in a section", () => {
    const file = freshFile();
    const cfg = makeConfig(file);
    appendEntries(cfg.memFile, "Decisions", ["Old entry"], cfg);
    overwriteSection(cfg.memFile, "Decisions", "- 2025-06-01: New entry", cfg);

    const section = readSection(cfg.memFile, "Decisions");
    assert.ok(!section?.includes("Old entry"));
    assert.ok(section?.includes("2025-06-01: New entry"));
    cleanup(file);
  });

  it("preserves other sections", () => {
    const file = freshFile();
    const cfg = makeConfig(file);
    appendEntries(cfg.memFile, "Decisions", ["Decision A"], cfg);
    appendEntries(cfg.memFile, "Patterns", ["Pattern A"], cfg);
    overwriteSection(cfg.memFile, "Decisions", "- Decision B", cfg);

    assert.ok(readSection(cfg.memFile, "Patterns")?.includes("Pattern A"));
    assert.ok(readSection(cfg.memFile, "Decisions")?.includes("Decision B"));
    cleanup(file);
  });
});

describe("searchMem", () => {
  it("finds entries by keyword (case-insensitive)", () => {
    const file = freshFile();
    const cfg = makeConfig(file);
    appendEntries(cfg.memFile, "Decisions", ["Using FastAPI for API layer"], cfg);
    appendEntries(cfg.memFile, "Patterns", ["Always use labnet network"], cfg);

    const results = searchMem(cfg.memFile, "fastapi");
    assert.equal(results.length, 1);
    assert.equal(results[0].section, "Decisions");

    const results2 = searchMem(cfg.memFile, "labnet");
    assert.equal(results2.length, 1);
    assert.equal(results2[0].section, "Patterns");
    cleanup(file);
  });

  it("filters by section", () => {
    const file = freshFile();
    const cfg = makeConfig(file);
    appendEntries(cfg.memFile, "Decisions", ["Chose PostgreSQL"], cfg);
    appendEntries(cfg.memFile, "Patterns", ["PostgreSQL connection pooling"], cfg);

    const results = searchMem(cfg.memFile, "postgresql", "Decisions");
    assert.equal(results.length, 1);
    assert.equal(results[0].section, "Decisions");
    cleanup(file);
  });

  it("returns empty for no match", () => {
    const file = freshFile();
    const cfg = makeConfig(file);
    appendEntries(cfg.memFile, "Decisions", ["Using FastAPI"], cfg);
    const results = searchMem(cfg.memFile, "django");
    assert.equal(results.length, 0);
    cleanup(file);
  });
});

describe("computeCleanPlan / executeClean", () => {
  it("detects duplicates", () => {
    const file = freshFile();
    const cfg = makeConfig(file);
    writeFileSync(cfg.memFile, `# Project Memory

## Decisions
- 2025-05-01: Same decision
- 2025-06-01: Same decision
- 2025-07-01: Different decision
`, "utf-8");

    const plan = computeCleanPlan(cfg.memFile, cfg);
    assert.equal(plan.duplicates.length, 1);
    assert.equal(plan.totalBefore, 3);
    assert.equal(plan.totalAfter, 2);
    cleanup(file);
  });

  it("detects stale entries in Changelog", () => {
    const file = freshFile();
    const cfg = makeConfig(file, { maxAgeDays: 30 });
    writeFileSync(cfg.memFile, `# Project Memory

## Changelog
- 2020-01-01: Very old entry
- 2026-05-30: Recent entry
`, "utf-8");

    const plan = computeCleanPlan(cfg.memFile, cfg);
    assert.equal(plan.stale.length, 1);
    assert.ok(plan.stale[0].text.includes("Very old entry"));
    cleanup(file);
  });

  it("does not age out Patterns section", () => {
    const file = freshFile();
    const cfg = makeConfig(file, { maxAgeDays: 1 });
    writeFileSync(cfg.memFile, `# Project Memory

## Patterns
- 2020-01-01: Old pattern
`, "utf-8");

    const plan = computeCleanPlan(cfg.memFile, cfg);
    assert.equal(plan.stale.length, 0, "Patterns should not age out");
    cleanup(file);
  });

  it("executeClean removes duplicates and stale entries", () => {
    const file = freshFile();
    const cfg = makeConfig(file, { maxAgeDays: 30 });
    writeFileSync(cfg.memFile, `# Project Memory

## Decisions
- 2025-05-01: Duplicate
- 2025-06-01: Duplicate

## Changelog
- 2020-01-01: Stale entry
- 2026-05-30: Keep this
`, "utf-8");

    const plan = computeCleanPlan(cfg.memFile, cfg);
    executeClean(cfg.memFile, cfg, plan);

    const dec = readSection(cfg.memFile, "Decisions");
    assert.ok(dec?.includes("Duplicate"));
    assert.equal((dec?.match(/Duplicate/g) ?? []).length, 1);

    const changelog = readSection(cfg.memFile, "Changelog");
    assert.ok(!changelog?.includes("Stale entry"));
    assert.ok(changelog?.includes("Keep this"));
    cleanup(file);
  });
});

describe("getStats", () => {
  it("returns correct stats", () => {
    const file = freshFile();
    const cfg = makeConfig(file);
    appendEntries(cfg.memFile, "Decisions", ["Entry 1", "Entry 2"], cfg);
    appendEntries(cfg.memFile, "Patterns", ["Pattern 1"], cfg);

    const stats = getStats(cfg.memFile);
    assert.equal(stats.fileExists, true);
    assert.equal(stats.totalEntries, 3);
    assert.equal(stats.entriesBySection["Decisions"], 2);
    assert.equal(stats.entriesBySection["Patterns"], 1);
    cleanup(file);
  });

  it("returns empty stats for missing file", () => {
    const cfg = makeConfig(freshFile());
    const stats = getStats(cfg.memFile);
    assert.equal(stats.fileExists, false);
    assert.equal(stats.totalEntries, 0);
  });
});
