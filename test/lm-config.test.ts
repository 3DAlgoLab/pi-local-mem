import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { sectionGetsDate, sectionAgesOut } from "../src/lm-config.js";

describe("sectionGetsDate", () => {
  it("returns true for dated sections", () => {
    assert.equal(sectionGetsDate("Decisions"), true);
    assert.equal(sectionGetsDate("Bugs & Fixes"), true);
    assert.equal(sectionGetsDate("Changelog"), true);
  });

  it("returns false for undated sections", () => {
    assert.equal(sectionGetsDate("Active Context"), false);
    assert.equal(sectionGetsDate("Patterns"), false);
    assert.equal(sectionGetsDate("Custom Section"), false);
  });
});

describe("sectionAgesOut", () => {
  it("returns true for ageable sections", () => {
    assert.equal(sectionAgesOut("Changelog"), true);
    assert.equal(sectionAgesOut("Bugs & Fixes"), true);
  });

  it("returns false for non-ageable sections", () => {
    assert.equal(sectionAgesOut("Decisions"), false);
    assert.equal(sectionAgesOut("Active Context"), false);
    assert.equal(sectionAgesOut("Patterns"), false);
  });
});
