import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { parseMem, serializeMem } from "../src/lm-file.js";

describe("parseMem / serializeMem", () => {
  it("parses dated entries", () => {
    const content = `# Project Memory

## Decisions
- 2025-05-05: Using FastAPI
- 2025-05-04: Chose PostgreSQL

## Active Context
- Docker uses Cloudflare Tunnel
`;
    const parsed = parseMem(content);
    assert.equal(parsed.get("Decisions")?.length, 2);
    assert.equal(parsed.get("Active Context")?.length, 1);

    const d1 = parsed.get("Decisions")![0];
    assert.equal(d1.date, "2025-05-05");
    assert.equal(d1.text, "Using FastAPI");

    const a1 = parsed.get("Active Context")![0];
    assert.equal(a1.date, undefined);
    assert.equal(a1.text, "Docker uses Cloudflare Tunnel");
  });

  it("serializes preserving section order", () => {
    const sections = new Map<string, ReturnType<typeof parseMem>[string]>();
    sections.set("Patterns", [{ section: "Patterns", text: "Conventional commits" }]);
    sections.set("Decisions", [{ section: "Decisions", text: "FastAPI", date: "2025-05-05" }]);

    const ordered = ["Decisions", "Patterns"];
    const output = serializeMem(sections, ordered);

    // Decisions should come before Patterns
    const decisionPos = output.indexOf("## Decisions");
    const patternPos = output.indexOf("## Patterns");
    assert.ok(decisionPos < patternPos, "Section order not preserved");
    assert.match(output, /- 2025-05-05: FastAPI/);
  });

  it("handles empty content", () => {
    const parsed = parseMem("");
    assert.equal(parsed.size, 0);
  });

  it("handles empty sections", () => {
    const content = `# Project Memory

## Decisions

## Active Context
`;
    const parsed = parseMem(content);
    assert.equal(parsed.get("Decisions")?.length, 0);
    assert.equal(parsed.get("Active Context")?.length, 0);
  });

  it("merges duplicate section headers", () => {
    const content = `# Project Memory

## Decisions
- 2025-05-05: First entry

## Decisions
- 2025-05-06: Second entry
`;
    const parsed = parseMem(content);
    assert.equal(parsed.get("Decisions")?.length, 2);
  });
});
