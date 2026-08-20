import { describe, expect, it } from "vitest";
import * as entryPoint from "./index.js";

describe("public entry point", () => {
  it("exports the measurement record helpers, and nothing that does not exist yet", () => {
    expect(typeof entryPoint.createMeasurement).toBe("function");
    expect(typeof entryPoint.summarizeTrials).toBe("function");

    // Keep this list in sync with src/index.ts by hand. This is not a
    // roundabout way to raise coverage — it exists so that adding a
    // re-export to index.ts without adding it here (or vice versa) is a
    // visible, deliberate diff instead of a silent one, since the whole
    // point of this file is "export only what exists".
    expect(Object.keys(entryPoint).sort()).toEqual(["createMeasurement", "summarizeTrials"]);
  });
});
