/**
 * Pure "result assembly" for `bench/run.mjs`: combines what a payload
 * measured with what the environment probe gathered into the exact JSON
 * this repo's `npm run bench` writes to disk. No I/O, no browser — takes
 * already-measured values in, returns a plain object out, so it is
 * unit-testable the same way `src/measurement.ts` itself is.
 */

import { createMeasurement, type BrowserInfo, type GpuAdapterInfo, type Measurement, type StorageKind } from "../measurement.js";
import type { EnvironmentExtras } from "./environment.js";

export interface BuildBenchOutputParams {
  readonly label: string;
  readonly unit: string;
  /** Raw per-trial values, in the order the payload ran them. */
  readonly trials: readonly number[];
  readonly browser: BrowserInfo;
  readonly gpu: GpuAdapterInfo;
  readonly storage: StorageKind;
  readonly fileSizeBytes: number;
  readonly chunkSizeBytes: number;
  readonly environment: EnvironmentExtras;
  readonly timestamp?: string;
}

/**
 * What `npm run bench` writes to `bench/results/*.json`. `measurement`
 * conforms exactly to `src/measurement.ts`'s `Measurement<number>` — the
 * "result JSON must use the record type from src/measurement.ts"
 * requirement in issue #1. `environment` carries machine-identity facts
 * (platform, CPU core count, storage quota, GPU device limits) that issue
 * #1 also asks this harness to capture but that aren't part of that
 * `Conditions` shape today; see bench/README.md for why they travel
 * alongside the measurement instead of inside `conditions`.
 */
export interface BenchOutput {
  readonly measurement: Measurement<number>;
  readonly environment: EnvironmentExtras;
}

export function buildBenchOutput(params: BuildBenchOutputParams): BenchOutput {
  const measurement = createMeasurement<number>({
    label: params.label,
    unit: params.unit,
    trials: params.trials,
    timestamp: params.timestamp,
    conditions: {
      browser: params.browser,
      gpu: params.gpu,
      storage: params.storage,
      fileSizeBytes: params.fileSizeBytes,
      chunkSizeBytes: params.chunkSizeBytes,
      trialCount: params.trials.length,
    },
  });

  return { measurement, environment: params.environment };
}
