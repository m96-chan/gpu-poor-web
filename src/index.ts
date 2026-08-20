/**
 * Public entry point for gpu-poor-web.
 *
 * This repository is research-stage (see README.md: "Status: research.
 * Nothing runs yet."). Export only what actually exists — no placeholder
 * exports for planned modules (weight streaming, the layer-paging
 * executor, env adapters). Each of those lands here in its own PR, against
 * its own issue, when it exists.
 */

export {
  createMeasurement,
  summarizeTrials,
  type BrowserInfo,
  type Conditions,
  type CreateMeasurementParams,
  type GpuAdapterInfo,
  type Measurement,
  type StorageKind,
  type TrialSummary,
} from "./measurement.js";
