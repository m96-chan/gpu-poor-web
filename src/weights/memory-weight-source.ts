import { clampRead, type WeightSource } from "./weight-source.js";

/**
 * The control condition: a `WeightSource` backed by an `ArrayBuffer`
 * already resident in memory. No storage I/O at all, so a bench trial run
 * against this source measures the ceiling every other backend is
 * compared against — the fastest a `read()` can possibly be once the
 * bytes already exist somewhere in the process, which is the number every
 * OPFS/FSA/HTTP throughput result this repository measures gets read
 * relative to (README: "the physics you don't get to argue with").
 *
 * Does not clone `buffer` at construction: for the multi-gigabyte weight
 * blobs this control condition exists to bound (README's physics table —
 * ~8 GB for an 8B model), doubling that in memory just to be defensive
 * would be its own confound. Ownership of `buffer` is effectively
 * transferred to this source — a caller that mutates it after construction
 * will see that mutation reflected in later reads, the same way a real
 * file changing on disk would be reflected by the storage-backed sources
 * in this directory. `read()` itself still always COPIES bytes out into
 * the caller's destination (never hands back a view aliasing the backing
 * buffer) for the same reason `InMemoryChunkStore.get` in `chunk-store.ts`
 * copies on read: a caller must not be able to corrupt this source's own
 * data by mutating a buffer it thinks is its own.
 */
export class InMemoryWeightSource implements WeightSource {
  private readonly bytes: Uint8Array;

  constructor(buffer: ArrayBufferLike) {
    this.bytes = new Uint8Array(buffer);
  }

  async size(): Promise<number> {
    return this.bytes.byteLength;
  }

  async read(destination: Uint8Array, offset: number): Promise<number> {
    const { offset: at, length } = clampRead(offset, destination.byteLength, this.bytes.byteLength);
    if (length === 0) return 0;
    destination.set(this.bytes.subarray(at, at + length));
    return length;
  }

  // No `close()`: nothing here is a handle or a connection, only a plain
  // array already owned by this process — there is nothing to release.
}
