import { describe, expect, it } from "vitest";
import {
  createMeasurement,
  summarizeTrials,
  type Conditions,
  type Measurement,
} from "./measurement.js";

/**
 * A fully-specified, valid set of conditions to reuse across tests. Every
 * field here is required by CLAUDE.md rule 7 ("record measurements together
 * with their conditions"): browser + version, GPU/adapter, storage, file
 * size, chunk size, and trial count.
 */
function validConditions(overrides: Partial<Conditions> = {}): Conditions {
  return {
    browser: {
      name: "Chrome",
      version: "128.0.6613.137",
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.6613.137 Safari/537.36",
    },
    gpu: {
      available: true,
      vendor: "apple",
      architecture: "metal-3",
      device: "",
      description: "Apple M3",
    },
    storage: "opfs",
    fileSizeBytes: 8_000_000_000,
    chunkSizeBytes: 4_194_304,
    trialCount: 3,
    ...overrides,
  };
}

describe("createMeasurement", () => {
  it("builds a measurement record from valid conditions and matching trials", () => {
    const conditions = validConditions();
    const m = createMeasurement({
      label: "opfs read throughput",
      unit: "GB/s",
      conditions,
      trials: [2.1, 2.4, 2.2],
    });

    expect(m.label).toBe("opfs read throughput");
    expect(m.unit).toBe("GB/s");
    expect(m.conditions).toBe(conditions);
    expect(m.trials).toEqual([2.1, 2.4, 2.2]);
  });

  it("stamps a timestamp automatically when one is not supplied", () => {
    const before = Date.now();
    const m = createMeasurement({
      label: "x",
      unit: "GB/s",
      conditions: validConditions(),
      trials: [1, 1, 1],
    });
    const stamped = Date.parse(m.timestamp);

    expect(Number.isNaN(stamped)).toBe(false);
    expect(stamped).toBeGreaterThanOrEqual(before);
  });

  it("accepts an explicit timestamp instead of generating one", () => {
    const m = createMeasurement({
      label: "x",
      unit: "GB/s",
      conditions: validConditions(),
      trials: [1, 1, 1],
      timestamp: "2026-01-01T00:00:00.000Z",
    });

    expect(m.timestamp).toBe("2026-01-01T00:00:00.000Z");
  });

  it("throws when the number of trials does not match conditions.trialCount", () => {
    expect(() =>
      createMeasurement({
        label: "x",
        unit: "GB/s",
        conditions: validConditions({ trialCount: 5 }),
        trials: [1, 2, 3],
      }),
    ).toThrow(/trial count/i);
  });

  it("throws on an empty trials array (there is no summary without data)", () => {
    expect(() =>
      createMeasurement({
        label: "x",
        unit: "GB/s",
        conditions: validConditions({ trialCount: 0 }),
        trials: [],
      }),
    ).toThrow(/at least one/i);
  });

  it("throws when fileSizeBytes is not positive", () => {
    expect(() =>
      createMeasurement({
        label: "x",
        unit: "GB/s",
        conditions: validConditions({ fileSizeBytes: 0 }),
        trials: [1, 2, 3],
      }),
    ).toThrow(/fileSizeBytes/);
  });

  it("throws when chunkSizeBytes is not positive", () => {
    expect(() =>
      createMeasurement({
        label: "x",
        unit: "GB/s",
        conditions: validConditions({ chunkSizeBytes: -1 }),
        trials: [1, 2, 3],
      }),
    ).toThrow(/chunkSizeBytes/);
  });

  it("records an honest 'no GPU involved' condition rather than omitting the field", () => {
    const conditions = validConditions({
      gpu: { available: false, reason: "storage-only measurement, no WebGPU calls made" },
    });
    const m = createMeasurement({
      label: "opfs read throughput",
      unit: "GB/s",
      conditions,
      trials: [1, 1, 1],
    });

    expect(m.conditions.gpu.available).toBe(false);
  });

  it("is a type error to construct a Measurement without conditions (object literal)", () => {
    // @ts-expect-error — `conditions` is a required field of Measurement<T>;
    // this must not type-check. If someone weakens the type to make
    // `conditions` optional (or gives it a default), this line starts
    // compiling and `npm run typecheck` fails, catching the regression.
    const bad: Measurement<number> = {
      label: "x",
      unit: "GB/s",
      trials: [1, 2, 3],
      timestamp: "2026-01-01T00:00:00.000Z",
    };
    void bad;
  });

  it("is a type error to call createMeasurement without conditions", () => {
    // At the type level this must not compile — `conditions` is a required
    // parameter of createMeasurement, not merely of Measurement. At
    // runtime (vitest strips types via esbuild, so this line does execute)
    // the missing field surfaces immediately as a TypeError rather than
    // silently producing a conditions-less record, which is the runtime
    // half of the same guarantee.
    expect(() =>
      // @ts-expect-error — `conditions` is required.
      createMeasurement({
        label: "x",
        unit: "GB/s",
        trials: [1, 2, 3],
      }),
    ).toThrow();
  });

  it("is a type error to mutate trials after construction (readonly)", () => {
    const m = createMeasurement({
      label: "x",
      unit: "GB/s",
      conditions: validConditions(),
      trials: [1, 2, 3],
    });

    // @ts-expect-error — `trials` is `readonly T[]`; it has no `push`.
    m.trials.push(4);
  });
});

describe("summarizeTrials", () => {
  it("reports median, min, and max for an odd number of trials", () => {
    const s = summarizeTrials([3, 1, 2]);
    expect(s).toEqual({ median: 2, min: 1, max: 3, count: 3 });
  });

  it("reports the average of the two middle values for an even number of trials", () => {
    const s = summarizeTrials([1, 2, 3, 4]);
    expect(s).toEqual({ median: 2.5, min: 1, max: 4, count: 4 });
  });

  it("handles a single trial", () => {
    const s = summarizeTrials([7]);
    expect(s).toEqual({ median: 7, min: 7, max: 7, count: 1 });
  });

  it("does not mutate the input array", () => {
    const input = [3, 1, 2];
    summarizeTrials(input);
    expect(input).toEqual([3, 1, 2]);
  });

  it("throws on an empty array", () => {
    expect(() => summarizeTrials([])).toThrow(/at least one/i);
  });
});
