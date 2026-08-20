// The E1-issue-#1 trivial smoke payload: OPFS write -> OPFS read -> GPU
// writeBuffer, `trialCount` times, reporting combined read+GPU-transfer
// GB/s per trial (the per-token-relevant leg for the paging use case — see
// README.md's "physics" table). Mirrors the pattern the E1 spike proved
// works end-to-end (scratchpad/spike/e2e-bandwidth-page.js), extended to
// multiple trials and byte-correctness verification on every trial rather
// than a hand-run smoke check.
//
// This is explicitly NOT the real E1 experiment (see FINDINGS.md §5: the
// spike's own 3-trial run of this same shape showed ~50% trial-to-trial
// spread on the GPU-write leg). It exists so `npm run bench` has something
// real to run for issue #1's definition of done. Issue #2 drops in the
// real experiment as a new file in this directory — bench/run.mjs does not
// change to add one; see "Adding a payload" in bench/README.md.
//
// Runs entirely inside the browser page (passed to `page.evaluate`), so it
// can only reference in-page globals (navigator, GPUBufferUsage,
// GPUMapMode, performance) — no Node scope, no imports.

/** How this payload's numbers should be labeled in the output Measurement. */
export const PAYLOAD_LABEL = "opfs-write-read-gpu-writebuffer smoke (read+GPU-transfer combined)";
/** Unit the trial values are expressed in. */
export const PAYLOAD_UNIT = "GB/s";
/** Which `StorageKind` (src/measurement.ts) this payload exercises. */
export const PAYLOAD_STORAGE = "opfs";

/**
 * Runs inside the page via `page.evaluate(runPayload, params)`. Requires a
 * WebGPU device to already be obtainable (the launcher calls
 * `requireGpu()` before ever reaching this payload, per issue #1's
 * "fail loudly instead of silently reporting zeros" requirement) — if
 * `navigator.gpu.requestAdapter()` fails here anyway (e.g. torn down
 * between the environment probe and the payload run), this throws rather
 * than returning a zero trial.
 */
export async function runPayload({ fileSizeBytes, chunkSizeBytes, trialCount }) {
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) {
    throw new Error("bench smoke payload: navigator.gpu.requestAdapter() returned null");
  }
  const device = await adapter.requestDevice();

  const trials = [];

  for (let trial = 0; trial < trialCount; trial++) {
    const fileName = `bench-smoke-${trial}`;
    const root = await navigator.storage.getDirectory();
    const fileHandle = await root.getFileHandle(fileName, { create: true });

    // --- OPFS write (one-time model-install cost; not timed into the
    // reported per-trial number, matching FINDINGS.md §5's framing) ---
    const writable = await fileHandle.createWritable();
    let written = 0;
    while (written < fileSizeBytes) {
      const thisChunkSize = Math.min(chunkSizeBytes, fileSizeBytes - written);
      const buf = new Uint8Array(thisChunkSize);
      for (let i = 0; i < thisChunkSize; i++) buf[i] = (written + i) & 0xff;
      await writable.write(buf);
      written += thisChunkSize;
    }
    await writable.close();

    // --- OPFS read into ArrayBuffer ---
    const readStart = performance.now();
    const file = await fileHandle.getFile();
    const arrayBuffer = await file.arrayBuffer();
    const readMs = performance.now() - readStart;

    // --- GPU writeBuffer ---
    const gpuBuffer = device.createBuffer({
      size: fileSizeBytes,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    });
    const writeStart = performance.now();
    device.queue.writeBuffer(gpuBuffer, 0, arrayBuffer);
    await device.queue.onSubmittedWorkDone();
    const writeMs = performance.now() - writeStart;

    // --- verify byte-correctness on this trial (fail loudly, don't trust
    // an unverified number) ---
    const verifySize = Math.min(4 * 1024 * 1024, fileSizeBytes);
    const readBackBuffer = device.createBuffer({
      size: verifySize,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const encoder = device.createCommandEncoder();
    encoder.copyBufferToBuffer(gpuBuffer, 0, readBackBuffer, 0, verifySize);
    device.queue.submit([encoder.finish()]);
    await readBackBuffer.mapAsync(GPUMapMode.READ);
    const verifyView = new Uint8Array(readBackBuffer.getMappedRange().slice(0));
    readBackBuffer.unmap();

    let verifyOk = true;
    for (let i = 0; i < verifyView.length; i += 4001) {
      if (verifyView[i] !== (i & 0xff)) {
        verifyOk = false;
        break;
      }
    }

    gpuBuffer.destroy();
    readBackBuffer.destroy();
    await root.removeEntry(fileName);

    if (!verifyOk) {
      throw new Error(`bench smoke payload: readback verification failed on trial ${trial}`);
    }

    const combinedMs = readMs + writeMs;
    const gbps = fileSizeBytes / (combinedMs / 1000) / 1e9;
    trials.push(gbps);
  }

  return { trials };
}
