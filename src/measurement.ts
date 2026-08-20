/**
 * The measurement record format required by CLAUDE.md rule 7 ("record
 * measurements together with their conditions") and issue #1.
 *
 * The core design constraint: a measured number must be inseparable from
 * the conditions it was measured under. `Measurement<T>.conditions` is a
 * required field with no default and no optional marker, so `Conditions`
 * cannot be dropped, only replaced with a different (still fully-specified)
 * `Conditions`. `createMeasurement` mirrors that at its call site. Both are
 * proven by `@ts-expect-error` tests in `measurement.test.ts` that fail
 * `npm run typecheck` if the guarantee is ever weakened.
 */

/** The browser a measurement was taken in. Read from `navigator.userAgent`
 * (or an automation tool's reported version) at measurement time — never
 * hard-coded, per CLAUDE.md rule 2 ("never guess, verify empirically"). */
export interface BrowserInfo {
  readonly name: string;
  readonly version: string;
  readonly userAgent: string;
}

/**
 * The WebGPU adapter a measurement ran against, or an honest statement that
 * no adapter was involved (e.g. a storage-only read-throughput measurement
 * that never called `navigator.gpu`). Modeled as a discriminated union
 * rather than a nullable field so "no GPU" always carries a reason instead
 * of silently looking like a forgotten field.
 *
 * Field names mirror the WebGPU spec's `GPUAdapterInfo` (`vendor`,
 * `architecture`, `device`, `description`) so they can be populated
 * directly from `GPUAdapter.info` without translation.
 */
export type GpuAdapterInfo =
  | {
      readonly available: true;
      readonly vendor: string;
      readonly architecture: string;
      readonly device: string;
      readonly description: string;
    }
  | {
      readonly available: false;
      readonly reason: string;
    };

/**
 * Where the bytes came from. Mirrors the `WeightSource` abstraction named
 * in CLAUDE.md's architecture principles (FSA / OPFS / HTTP Range /
 * memory) so a measurement's storage condition and the code path that
 * produced it share vocabulary.
 */
export type StorageKind = "opfs" | "file-system-access" | "http-range" | "memory";

/**
 * Everything a measured number needs to be reproducible. Every field is
 * required: a `Measurement` missing any of these does not count as a
 * result (CLAUDE.md rule 7).
 */
export interface Conditions {
  readonly browser: BrowserInfo;
  readonly gpu: GpuAdapterInfo;
  readonly storage: StorageKind;
  readonly fileSizeBytes: number;
  readonly chunkSizeBytes: number;
  readonly trialCount: number;
}

/**
 * A measured quantity together with the conditions it was measured under,
 * and the raw per-trial values — not just a mean. `T` is the per-trial
 * value's type (a `number` for most throughput/latency measurements, but
 * left generic so richer per-trial payloads aren't forced through it).
 */
export interface Measurement<T = number> {
  /** What was measured, e.g. "opfs sequential read throughput". */
  readonly label: string;
  /** Unit the trial values and summary are expressed in, e.g. "GB/s". */
  readonly unit: string;
  readonly conditions: Conditions;
  /** Raw values, one per trial, in the order they were run. */
  readonly trials: readonly T[];
  /** ISO 8601 timestamp of when the measurement was taken. */
  readonly timestamp: string;
}

export interface CreateMeasurementParams<T> {
  readonly label: string;
  readonly unit: string;
  readonly conditions: Conditions;
  readonly trials: readonly T[];
  readonly timestamp?: string;
}

/**
 * Builds a `Measurement`, validating that the raw trial data is consistent
 * with the conditions it claims to have been taken under. This is the only
 * intended constructor for `Measurement` — prefer it over an object literal
 * so these checks always run.
 */
export function createMeasurement<T>(params: CreateMeasurementParams<T>): Measurement<T> {
  const { label, unit, conditions, trials, timestamp } = params;

  if (trials.length === 0) {
    throw new Error("createMeasurement: need at least one trial to record a measurement");
  }
  if (trials.length !== conditions.trialCount) {
    throw new Error(
      `createMeasurement: trial count mismatch — conditions.trialCount is ${conditions.trialCount} but ${trials.length} trial value(s) were given`,
    );
  }
  if (!(conditions.fileSizeBytes > 0)) {
    throw new Error(
      `createMeasurement: conditions.fileSizeBytes must be positive, got ${conditions.fileSizeBytes}`,
    );
  }
  if (!(conditions.chunkSizeBytes > 0)) {
    throw new Error(
      `createMeasurement: conditions.chunkSizeBytes must be positive, got ${conditions.chunkSizeBytes}`,
    );
  }

  return {
    label,
    unit,
    conditions,
    trials,
    timestamp: timestamp ?? new Date().toISOString(),
  };
}

/** Median, min, and max of a set of trial values, plus the trial count. */
export interface TrialSummary {
  readonly median: number;
  readonly min: number;
  readonly max: number;
  readonly count: number;
}

/**
 * Summarizes raw trial values as median/min/max.
 *
 * Deliberately not a mean. Storage-bandwidth trials are not drawn from a
 * symmetric, thin-tailed distribution: a page-cache-warm read, a cold read
 * behind a filesystem journal flush, or a trial that lands during macOS
 * Spotlight indexing can each be many times slower (or faster) than a
 * "typical" trial. A mean lets one such outlier move the reported number by
 * an amount unrelated to what a user would usually observe, and it hides
 * the outlier instead of surfacing it. The median is robust to that kind of
 * skew, and reporting `min`/`max` alongside it keeps the instability
 * visible instead of averaging it away — which matters here, since the
 * whole point of this repository's measurements is to establish a floor,
 * not a flattering average (see README, "the physics you don't get to
 * argue with").
 */
export function summarizeTrials(trials: readonly number[]): TrialSummary {
  if (trials.length === 0) {
    throw new Error("summarizeTrials: need at least one trial to summarize");
  }

  const sorted = [...trials].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0 ? ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2 : (sorted[mid] as number);

  return {
    median,
    min: sorted[0] as number,
    max: sorted[sorted.length - 1] as number,
    count: sorted.length,
  };
}
