/**
 * The abstraction CLAUDE.md's architecture principles name explicitly:
 * "Hide the source of weights behind a `WeightSource` abstraction (FSA /
 * OPFS / HTTP Range / memory), so that comparing streaming strategies is
 * just a matter of swapping the implementation." Modeled on
 * `web-xpu-ops`'s own `ChunkStore` (`llm/chunk-store.ts`, read for design
 * guidance before writing this) — deliberately tiny, no extra surface
 * pushed onto the interface that a caller can encode for itself in a key
 * or a parameter — but the READ signature is not copied from it, because
 * the two interfaces exist to solve different problems.
 *
 * `ChunkStore` serves whole named blobs, written once and read back whole,
 * for a persistent cache consulted once per page load. A `WeightSource`
 * serves arbitrary byte RANGES of one big file, called repeatedly — once
 * per layer's weight tensor, per token, for as long as generation runs
 * (see README's physics table: an 8B model decoding one token means
 * streaming ~8 GB through this interface). At that call frequency,
 * `read(offset, length): Promise<ArrayBuffer>` — the obvious shape, and
 * the one `ChunkStore.get` uses — is a bug by construction: a fresh
 * `ArrayBuffer` allocated on every call, for every layer, for every token,
 * forever. That allocation (and the GC pressure it creates) is exactly the
 * cost this repository exists to measure honestly; a `WeightSource` that
 * forced it into every implementation would make our own interface the
 * confound in every comparison we run.
 *
 * Instead `read` takes a CALLER-SUPPLIED destination `Uint8Array` and
 * copies into it, returning the number of bytes actually written. The
 * executor (E2) can allocate a small, fixed set of staging buffers once —
 * one, or two for double-buffering compute against the next layer's
 * transfer — and hand the same buffer back on every call for that buffer's
 * lifetime. Implementations that back onto an API with a "write into this
 * buffer" primitive (`FileSystemSyncAccessHandle.read(buffer, {at})`, the
 * whole reason OPFS's sync access handle exists over the plain
 * `getFile()`/`Blob` path — see `opfs-sync-weight-source.ts`) honor that
 * literally, with zero intermediate allocation per call. Implementations
 * that cannot avoid an intermediate allocation (`Blob.slice().arrayBuffer()`
 * for File System Access — there is no "read into my buffer" primitive on
 * `Blob`, per `lib.dom.d.ts`; a streamed `fetch` body for HTTP Range) still
 * copy into the caller's buffer rather than returning their own, so the
 * *interface's* contract stays uniform even where a *backend's* own
 * contract falls short of it — and that shortfall is measurable, not
 * hidden, because the bench harness (E1) can size its trial buffers
 * however it wants and watch each backend's real allocation behavior in
 * the browser's own profiler.
 *
 * Returning the byte count actually written (rather than assuming it
 * always equals what was asked) is what lets a caller-supplied destination
 * and honest EOF/short-read behavior coexist: reading past end-of-file, or
 * asking for more than remains, is not an error — it mirrors `Blob.slice`,
 * which silently clamps to the blob's own size — it is reported by
 * returning fewer bytes than the destination could hold, the same way
 * `FileSystemSyncAccessHandle.read` and POSIX `read(2)` already do. Every
 * implementation in this directory delegates that boundary arithmetic to
 * `clampRead` below instead of reimplementing it.
 */
export interface WeightSource {
  /**
   * Total size of the underlying file/resource in bytes. May require I/O
   * (an HTTP HEAD request, a filesystem stat) depending on the backend —
   * async unconditionally so every implementation has the same shape, and
   * so calling code can never accidentally depend on this happening to be
   * synchronous for one particular backend.
   */
  size(): Promise<number>;

  /**
   * Reads up to `destination.byteLength` bytes starting at byte `offset`
   * into `destination`, and returns the number of bytes actually written
   * (`0 <= n <= destination.byteLength`). Never allocates and returns a
   * new buffer — always writes into the one given.
   *
   * `offset` must be a non-negative integer. `offset >= size()` and
   * `destination.byteLength === 0` are not errors; both read zero bytes. A
   * read that extends past end-of-file is clamped, not rejected: it
   * returns fewer bytes than `destination.byteLength`, never throws for
   * that reason alone.
   *
   * Concurrent calls — possibly overlapping in the ranges they read,
   * always writing to their own distinct `destination` — must be safe: an
   * executor double-buffering transfer against compute will have two reads
   * in flight at once. Concurrent calls given the SAME `destination` are
   * the caller's bug (a data race on a plain array), not this interface's
   * to prevent.
   */
  read(destination: Uint8Array, offset: number): Promise<number>;

  /**
   * Releases any resources this source holds open (a sync access handle's
   * exclusive file lock, an open file descriptor). Optional: the in-memory
   * and HTTP Range sources hold nothing that needs releasing. Idempotent —
   * safe to call more than once, and safe to never call for a source whose
   * process is about to end anyway.
   */
  close?(): Promise<void>;
}

/** The result of clamping a requested read to what a source of a known
 * size can actually satisfy: the offset unchanged, and the length reduced
 * to whatever is available (0 at or past end-of-file). */
export interface ReadPlan {
  readonly offset: number;
  readonly length: number;
}

/**
 * The boundary arithmetic every `WeightSource.read` implementation in this
 * directory shares, factored out once rather than reimplemented per
 * backend (and re-verified per backend against the boundary cases in
 * `weight-source.test.ts`): given a requested `offset`/`requestedLength`
 * against a resource of `sizeBytes`, returns the offset/length actually
 * readable.
 *
 * - A zero-length request, or an `offset` at or past `sizeBytes`, plans a
 *   zero-length read rather than throwing — both are ordinary, not error,
 *   conditions (mirrors `Blob.slice`, which returns an empty `Blob` for
 *   either).
 * - A request that runs past end-of-file is clamped to what remains, never
 *   rejected.
 * - `offset`, `requestedLength`, and `sizeBytes` must each be non-negative
 *   integers; anything else (a negative offset, a fractional length, a
 *   negative size a buggy backend reported) is a programmer/backend error,
 *   not a normal boundary condition, and throws a `RangeError` rather than
 *   being silently clamped — clamping *that* would hide a bug this
 *   function's callers should see.
 */
export function clampRead(offset: number, requestedLength: number, sizeBytes: number): ReadPlan {
  if (!Number.isInteger(offset) || offset < 0) {
    throw new RangeError(`clampRead: offset must be a non-negative integer, got ${offset}`);
  }
  if (!Number.isInteger(requestedLength) || requestedLength < 0) {
    throw new RangeError(`clampRead: requestedLength must be a non-negative integer, got ${requestedLength}`);
  }
  if (!Number.isInteger(sizeBytes) || sizeBytes < 0) {
    throw new RangeError(`clampRead: sizeBytes must be a non-negative integer, got ${sizeBytes}`);
  }

  if (requestedLength === 0 || offset >= sizeBytes) {
    return { offset, length: 0 };
  }

  const available = sizeBytes - offset;
  return { offset, length: Math.min(requestedLength, available) };
}

/**
 * Splits one `[offset, offset + length)` range into consecutive,
 * non-overlapping sub-ranges of at most `chunkSizeBytes` each, in order.
 * Used by backends whose underlying read primitive allocates an
 * intermediate buffer per call (`FileSystemAccessWeightSource`'s
 * `Blob.slice().arrayBuffer()` — see that file) to bound that allocation's
 * peak size at `chunkSizeBytes` regardless of how large a single `read()`
 * call's destination is, the same peak-memory reasoning
 * `weight-cache.ts#iterateChunks` documents for chunking a whole-file
 * write.
 *
 * Unlike `iterateChunks`, a zero-length range yields NO sub-ranges (not
 * one empty one): `iterateChunks` yields one empty chunk so a zero-byte
 * *file* still gets a chunk key written and is distinguishable from "0
 * chunks = no file was ever written" on readback. Nothing here reconstructs
 * anything from the sub-ranges this function yields — a caller that gets
 * zero sub-ranges for a zero-length request already knows unambiguously
 * that zero bytes were requested, so an empty sub-range would only be
 * useless extra work (one pointless `Blob.slice(0, 0)` call, in the FSA
 * case).
 */
export function* planChunkedRead(
  offset: number,
  length: number,
  chunkSizeBytes: number,
): Generator<ReadPlan, void, undefined> {
  if (!Number.isInteger(chunkSizeBytes) || chunkSizeBytes <= 0) {
    throw new RangeError(`planChunkedRead: chunkSizeBytes must be a positive integer, got ${chunkSizeBytes}`);
  }
  for (let done = 0; done < length; done += chunkSizeBytes) {
    yield { offset: offset + done, length: Math.min(chunkSizeBytes, length - done) };
  }
}
