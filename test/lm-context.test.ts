import { describe, it, after } from "node:test";
import { strict as assert } from "node:assert";
import { writeFileSync, unlinkSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { buildContextBlock, buildLightweightContext } from "../src/lm-context.js";
import { getStats } from "../src/lm-file.js";
import type { LocalMemConfig } from "../src/lm-config.js";

const tmpDir = join(import.meta.dirname ?? "/tmp", ".lm-ctx-test");
const testFile = join(tmpDir, "LocalMem.md");

function makeConfig(overrides?: Partial<LocalMemConfig>): LocalMemConfig {
  return {
    enabled: true,
    maxSizeKb: 8,
    maxAgeDays: 90,
    sections: ["Decisions", "Active Context", "Bugs & Fixes", "Changelog", "Patterns"],
    autoInit: true,
    injectContext: true,
    memFile: testFile,
    projectRoot: tmpDir,
    ...overrides,
  };
}

after(() => {
  if (existsSync(testFile)) unlinkSync(testFile);
});

describe("buildContextBlock", () => {
  it("returns empty string when file doesn't exist", () => {
    const cfg = makeConfig({ memFile: join(tmpDir, "missing.md") });
    const stats = getStats(cfg.memFile);
    const block = buildContextBlock(cfg, stats);
    assert.equal(block, "");
  });

  it("returns empty string when file has no entries", () => {
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(testFile, "# Project Memory\n\n## Decisions\n\n## Active Context\n", "utf-8");

    const cfg = makeConfig();
    const stats = getStats(cfg.memFile);
    const block = buildContextBlock(cfg, stats);
    assert.equal(block, "");
    unlinkSync(testFile);
  });

  it("injects content wrapped in <localmem> tags", () => {
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(testFile, "# Project Memory\n\n## Decisions\n- 2025-05-05: Using FastAPI\n", "utf-8");

    const cfg = makeConfig();
    const stats = getStats(cfg.memFile);
    const block = buildContextBlock(cfg, stats);

    assert.ok(block.includes("<localmem>"));
    assert.ok(block.includes("</localmem>"));
    assert.ok(block.includes("Using FastAPI"));
    assert.ok(block.includes("When to write"));
    unlinkSync(testFile);
  });

  it("truncates content when exceeding maxSizeKb", () => {
    mkdirSync(tmpDir, { recursive: true });
    const longContent = "# Project Memory\n\n## Decisions\n" +
      Array.from({ length: 2000 }, (_, i) => "- 2025-05-0" + (i % 9 + 1) + ": Decision entry number " + i + " with a lot of extra text to ensure we definitely exceed the size limit")
        .join("\n") +
      "\n";
    writeFileSync(testFile, longContent, "utf-8");

    // maxSizeKb must be large enough that instructions fit, but small enough that full content doesn't
    const cfg = makeConfig({ maxSizeKb: 2 }); // 2048 bytes — instructions (~1329) + some content fits, but not all
    const stats = getStats(cfg.memFile);
    const block = buildContextBlock(cfg, stats);

    assert.ok(block.includes("truncated"), "Should contain truncation marker");
    assert.ok(Buffer.byteLength(block, "utf-8") <= 2048, "Should be within 2KB limit");
    unlinkSync(testFile);
  });
});

describe("buildLightweightContext", () => {
  it("returns empty string when file doesn't exist", () => {
    const stats = {
      fileExists: false,
      fileSizeKb: 0,
      totalEntries: 0,
      entriesBySection: {},
      lastModified: "",
      sections: [],
    };
    assert.equal(buildLightweightContext(stats as ReturnType<typeof getStats>), "");
  });

  it("returns a short pointer with stats", () => {
    const stats = {
      fileExists: true,
      fileSizeKb: 3.2,
      totalEntries: 15,
      entriesBySection: { Decisions: 10, Patterns: 5 },
      lastModified: "2025-05-30",
      sections: ["Decisions", "Patterns"],
    };
    const ctx = buildLightweightContext(stats as ReturnType<typeof getStats>);

    assert.ok(ctx.includes("LocalMem:"));
    assert.ok(ctx.includes("15 entries"));
    assert.ok(ctx.includes("localmem_read"));
    assert.ok(ctx.includes("localmem_search"));
  });
});
