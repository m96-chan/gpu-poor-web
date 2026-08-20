// In-page probe: gathers browser/GPU/machine facts that become a bench
// run's `Conditions` + `environment` extras. Runs *inside* the browser page
// via `page.evaluate(ENVIRONMENT_PROBE_SRC)` — everything it touches
// (navigator.gpu, navigator.storage, navigator.hardwareConcurrency) only
// exists in a page context, never in Node. Every fact here is read live
// from the running browser; nothing is hardcoded (issue #1's requirement).
//
// Interpreting this raw shape (deciding what counts as "GPU available",
// building the final Conditions/environment objects) is deliberately NOT
// done here — that logic lives in src/bench/environment.ts, where it can
// be unit-tested without a real browser. This file's only job is to ask
// the browser questions and hand back plain, JSON-serializable answers.
export async function ENVIRONMENT_PROBE_SRC() {
  const result = {
    userAgent: navigator.userAgent,
    isSecureContext: typeof isSecureContext !== "undefined" ? isSecureContext : false,
    hasNavigatorGpu: typeof navigator !== "undefined" && !!navigator.gpu,
    adapterAvailable: false,
    adapterInfo: null,
    adapterError: null,
    limits: null,
    platform: navigator.platform ?? "unknown",
    cpuCoreCount: navigator.hardwareConcurrency ?? 0,
    storageQuotaBytes: null,
  };

  try {
    if (navigator.storage && navigator.storage.estimate) {
      const estimate = await navigator.storage.estimate();
      result.storageQuotaBytes = typeof estimate.quota === "number" ? estimate.quota : null;
    }
  } catch (e) {
    // Leave storageQuotaBytes as null — an honest "couldn't get it" rather
    // than a fabricated number.
  }

  if (!result.hasNavigatorGpu) {
    return result;
  }

  try {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
      result.adapterError = "requestAdapter() returned null";
      return result;
    }
    const info = adapter.info ?? (adapter.requestAdapterInfo ? await adapter.requestAdapterInfo() : null);
    if (info) {
      result.adapterInfo = {
        vendor: info.vendor,
        architecture: info.architecture,
        device: info.device,
        description: info.description,
      };
    }

    const device = await adapter.requestDevice();
    result.adapterAvailable = true;
    result.limits = {
      maxBufferSize: device.limits.maxBufferSize,
      maxStorageBufferBindingSize: device.limits.maxStorageBufferBindingSize,
      maxComputeWorkgroupStorageSize: device.limits.maxComputeWorkgroupStorageSize,
      maxComputeInvocationsPerWorkgroup: device.limits.maxComputeInvocationsPerWorkgroup,
    };
  } catch (e) {
    result.adapterError = (e && e.message) || String(e);
  }

  return result;
}
