import { describe, expect, it } from "vitest";
import {
  buildEnvironmentExtras,
  parseBrowserVersion,
  requireGpu,
  toGpuAdapterInfo,
  type RawProbe,
} from "./environment.js";

function rawProbe(overrides: Partial<RawProbe> = {}): RawProbe {
  return {
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 HeadlessChrome/151.0.7922.138 Safari/537.36",
    isSecureContext: true,
    hasNavigatorGpu: true,
    adapterAvailable: true,
    adapterInfo: { vendor: "apple", architecture: "metal-3", device: "0x0000", description: "Apple M3" },
    adapterError: null,
    limits: {
      maxBufferSize: 268435456,
      maxStorageBufferBindingSize: 134217728,
      maxComputeWorkgroupStorageSize: 16384,
      maxComputeInvocationsPerWorkgroup: 256,
    },
    platform: "MacIntel",
    cpuCoreCount: 10,
    storageQuotaBytes: 494977568768,
    ...overrides,
  };
}

describe("parseBrowserVersion", () => {
  it("extracts Chrome name and version from a headless Chrome UA", () => {
    expect(parseBrowserVersion(rawProbe().userAgent)).toEqual({ name: "Chrome", version: "151.0.7922.138" });
  });

  it("extracts Chrome name and version from a headed Chrome UA", () => {
    const ua = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.7922.138 Safari/537.36";
    expect(parseBrowserVersion(ua)).toEqual({ name: "Chrome", version: "151.0.7922.138" });
  });

  it("falls back to 'unknown'/'unknown' for a UA it cannot parse rather than guessing", () => {
    expect(parseBrowserVersion("some-unrecognized-agent-string")).toEqual({ name: "unknown", version: "unknown" });
  });
});

describe("toGpuAdapterInfo", () => {
  it("maps an available adapter to the available:true variant", () => {
    expect(toGpuAdapterInfo(rawProbe())).toEqual({
      available: true,
      vendor: "apple",
      architecture: "metal-3",
      device: "0x0000",
      description: "Apple M3",
    });
  });

  it("reports available:false with a reason when navigator.gpu is undefined", () => {
    const result = toGpuAdapterInfo(rawProbe({ hasNavigatorGpu: false, adapterAvailable: false, adapterInfo: null, limits: null }));
    expect(result.available).toBe(false);
    expect((result as { reason: string }).reason).toMatch(/navigator\.gpu/i);
  });

  it("reports available:false with a reason when requestAdapter() returns null", () => {
    const result = toGpuAdapterInfo(
      rawProbe({ adapterAvailable: false, adapterInfo: null, limits: null, adapterError: "requestAdapter() returned null" }),
    );
    expect(result.available).toBe(false);
    expect((result as { reason: string }).reason).toBe("requestAdapter() returned null");
  });

  it("falls back to a default reason when requestAdapter() returns null and no adapterError was set", () => {
    const result = toGpuAdapterInfo(rawProbe({ adapterAvailable: false, adapterInfo: null, limits: null, adapterError: null }));
    expect(result.available).toBe(false);
    expect((result as { reason: string }).reason).toBe("requestAdapter() returned null");
  });
});

describe("requireGpu", () => {
  it("does not throw when the adapter is available", () => {
    expect(() => requireGpu(toGpuAdapterInfo(rawProbe()))).not.toThrow();
  });

  it("throws a clear, loud error (not a silent zero) when the adapter is unavailable", () => {
    const gpu = toGpuAdapterInfo(rawProbe({ hasNavigatorGpu: false, adapterAvailable: false, adapterInfo: null, limits: null }));
    expect(() => requireGpu(gpu)).toThrow(/webgpu.*unavailable/i);
  });
});

describe("buildEnvironmentExtras", () => {
  it("assembles platform, cpu core count, storage quota, and gpu limits from the raw probe", () => {
    expect(buildEnvironmentExtras(rawProbe())).toEqual({
      platform: "MacIntel",
      cpuCoreCount: 10,
      storageQuotaBytes: 494977568768,
      gpuLimits: {
        maxBufferSize: 268435456,
        maxStorageBufferBindingSize: 134217728,
        maxComputeWorkgroupStorageSize: 16384,
        maxComputeInvocationsPerWorkgroup: 256,
      },
    });
  });

  it("passes through a null storage quota (estimate() unsupported/denied) rather than fabricating one", () => {
    expect(buildEnvironmentExtras(rawProbe({ storageQuotaBytes: null })).storageQuotaBytes).toBeNull();
  });

  it("throws if limits are missing (no GPU device to read limits from)", () => {
    expect(() => buildEnvironmentExtras(rawProbe({ limits: null }))).toThrow(/limits/i);
  });
});
