/**
 * Pure translation from the raw, JSON-serializable facts an in-page probe
 * gathers (see `bench/environment-probe.mjs`) into the typed shapes this
 * repo records measurements with. Kept separate from the probe itself (and
 * from `bench/run.mjs`) so it is unit-testable without a real browser —
 * the probe's job is only to call `navigator.*` once and hand back plain
 * data; everything that interprets that data lives here, covered.
 */

import type { GpuAdapterInfo } from "../measurement.js";

/** Shape returned by `bench/environment-probe.mjs`'s in-page probe function.
 * Every field is something `navigator`/`GPUAdapter`/`GPUDevice` can hand
 * back directly — nothing here is inferred or hardcoded by the harness. */
export interface RawProbe {
  readonly userAgent: string;
  readonly isSecureContext: boolean;
  readonly hasNavigatorGpu: boolean;
  readonly adapterAvailable: boolean;
  readonly adapterInfo: {
    readonly vendor: string;
    readonly architecture: string;
    readonly device: string;
    readonly description: string;
  } | null;
  readonly adapterError: string | null;
  readonly limits: {
    readonly maxBufferSize: number;
    readonly maxStorageBufferBindingSize: number;
    readonly maxComputeWorkgroupStorageSize: number;
    readonly maxComputeInvocationsPerWorkgroup: number;
  } | null;
  readonly platform: string;
  readonly cpuCoreCount: number;
  /** `null` when `navigator.storage.estimate()` is unsupported or its
   * `quota` field is itself missing — never fabricated. */
  readonly storageQuotaBytes: number | null;
}

const BROWSER_VERSION_PATTERN = /(?:Headless)?Chrome\/([0-9.]+)/;

/**
 * Extracts a browser name/version pair from a `navigator.userAgent` string.
 * Only recognizes Chrome/HeadlessChrome (the only channel this harness
 * launches per the E1 spike's recommendation — see bench/README.md). Falls
 * back to `"unknown"/"unknown"` for anything else instead of guessing, so a
 * future different browser shows up as an honest gap rather than a
 * fabricated label.
 */
export function parseBrowserVersion(userAgent: string): { name: string; version: string } {
  const match = BROWSER_VERSION_PATTERN.exec(userAgent);
  if (!match) {
    return { name: "unknown", version: "unknown" };
  }
  return { name: "Chrome", version: match[1] as string };
}

/**
 * Maps a `RawProbe` into `src/measurement.ts`'s `GpuAdapterInfo`
 * discriminated union — honest `{available: false, reason}` rather than a
 * nullable field, matching that type's own design rationale.
 */
export function toGpuAdapterInfo(probe: RawProbe): GpuAdapterInfo {
  if (!probe.hasNavigatorGpu) {
    return {
      available: false,
      reason: "navigator.gpu is undefined (not a secure context, or WebGPU unsupported/disabled)",
    };
  }
  if (!probe.adapterAvailable || !probe.adapterInfo) {
    return {
      available: false,
      reason: probe.adapterError ?? "requestAdapter() returned null",
    };
  }
  return {
    available: true,
    vendor: probe.adapterInfo.vendor,
    architecture: probe.adapterInfo.architecture,
    device: probe.adapterInfo.device,
    description: probe.adapterInfo.description,
  };
}

/**
 * Fails loudly when WebGPU is unavailable, instead of letting the harness
 * carry on and report a payload's GPU-dependent trials as zero. This is the
 * "fail loudly ... rather than silently reporting zeros" requirement from
 * issue #1: every payload this harness ships for E1 touches the GPU, so a
 * missing adapter is a hard stop, not a degraded result.
 */
export function requireGpu(gpu: GpuAdapterInfo): asserts gpu is Extract<GpuAdapterInfo, { available: true }> {
  if (!gpu.available) {
    throw new Error(
      `WebGPU is unavailable in the launched browser, cannot run a GPU-dependent bench payload: ${gpu.reason}`,
    );
  }
}

/** Machine-identity facts this harness captures alongside a `Measurement`
 * but that don't fit `src/measurement.ts`'s `Conditions` shape (which is
 * owned by a different ticket — see bench/README.md for why these travel
 * as a sibling `environment` object in the output JSON instead). */
export interface EnvironmentExtras {
  readonly platform: string;
  readonly cpuCoreCount: number;
  readonly storageQuotaBytes: number | null;
  readonly gpuLimits: {
    readonly maxBufferSize: number;
    readonly maxStorageBufferBindingSize: number;
    readonly maxComputeWorkgroupStorageSize: number;
    readonly maxComputeInvocationsPerWorkgroup: number;
  };
}

/**
 * Assembles `EnvironmentExtras` from a `RawProbe`. Requires `probe.limits`
 * to be present (i.e. call after `requireGpu` has confirmed a device was
 * obtained) — limits come from `GPUDevice.limits`, so no device means no
 * honest limits to report.
 */
export function buildEnvironmentExtras(probe: RawProbe): EnvironmentExtras {
  if (!probe.limits) {
    throw new Error("buildEnvironmentExtras: probe.limits is missing (no GPUDevice was obtained)");
  }
  return {
    platform: probe.platform,
    cpuCoreCount: probe.cpuCoreCount,
    storageQuotaBytes: probe.storageQuotaBytes,
    gpuLimits: probe.limits,
  };
}
