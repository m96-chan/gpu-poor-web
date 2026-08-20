import { describe, expect, it } from "vitest";
import type { EnvironmentExtras } from "./environment.js";
import { buildBenchOutput } from "./report.js";

const environment: EnvironmentExtras = {
  platform: "MacIntel",
  cpuCoreCount: 10,
  storageQuotaBytes: 494977568768,
  gpuLimits: {
    maxBufferSize: 268435456,
    maxStorageBufferBindingSize: 134217728,
    maxComputeWorkgroupStorageSize: 16384,
    maxComputeInvocationsPerWorkgroup: 256,
  },
};

const baseParams = {
  label: "opfs-write-read-gpu-writebuffer smoke",
  unit: "GB/s",
  trials: [0.89, 1.22, 1.36],
  browser: { name: "Chrome", version: "151.0.7922.138", userAgent: "ua-string" },
  gpu: {
    available: true as const,
    vendor: "apple",
    architecture: "metal-3",
    device: "0x0000",
    description: "Apple M3",
  },
  storage: "opfs" as const,
  fileSizeBytes: 268435456,
  chunkSizeBytes: 16777216,
  environment,
  timestamp: "2026-08-21T00:00:00.000Z",
};

describe("buildBenchOutput", () => {
  it("assembles a Measurement (from src/measurement.ts) plus the environment extras", () => {
    const output = buildBenchOutput(baseParams);

    expect(output.measurement.label).toBe(baseParams.label);
    expect(output.measurement.unit).toBe("GB/s");
    expect(output.measurement.trials).toEqual(baseParams.trials);
    expect(output.measurement.timestamp).toBe("2026-08-21T00:00:00.000Z");
    expect(output.measurement.conditions).toEqual({
      browser: baseParams.browser,
      gpu: baseParams.gpu,
      storage: "opfs",
      fileSizeBytes: baseParams.fileSizeBytes,
      chunkSizeBytes: baseParams.chunkSizeBytes,
      trialCount: 3,
    });
    expect(output.environment).toEqual(environment);
  });

  it("derives trialCount from the trials actually given, not a separate input", () => {
    const output = buildBenchOutput({ ...baseParams, trials: [1, 2] });
    expect(output.measurement.conditions.trialCount).toBe(2);
    expect(output.measurement.trials).toEqual([1, 2]);
  });

  it("propagates createMeasurement's validation (e.g. rejects an empty trial set)", () => {
    expect(() => buildBenchOutput({ ...baseParams, trials: [] })).toThrow(/at least one trial/i);
  });

  it("defaults timestamp to now when not given", () => {
    const before = Date.now();
    const output = buildBenchOutput({ ...baseParams, timestamp: undefined });
    const parsed = Date.parse(output.measurement.timestamp);
    expect(parsed).toBeGreaterThanOrEqual(before);
  });
});
