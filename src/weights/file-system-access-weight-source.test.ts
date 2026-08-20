import { describe, expect, it, vi } from "vitest";
import type { MinimalBlob, MinimalFileSystemFileHandle } from "./browser-types.js";
import { DEFAULT_FSA_CHUNK_SIZE_BYTES, FileSystemAccessWeightSource, pickLocalFileSystemAccessSource } from "./file-system-access-weight-source.js";
import type { WeightSource } from "./weight-source.js";

/** A fake `Blob`/`File` honoring `MinimalBlob`'s contract (`size`,
 * `slice(start?, end?)` clamping to the blob's own size the way the real
 * `Blob.slice` does, `arrayBuffer()`). */
function fakeBlob(bytes: Uint8Array): MinimalBlob {
  return {
    size: bytes.byteLength,
    slice(start = 0, end = bytes.byteLength): MinimalBlob {
      const clampedEnd = Math.min(end, bytes.byteLength);
      const clampedStart = Math.min(start, clampedEnd);
      return fakeBlob(bytes.subarray(clampedStart, clampedEnd));
    },
    async arrayBuffer(): Promise<ArrayBuffer> {
      return bytes.slice().buffer;
    },
  };
}

/** A fake `FileSystemFileHandle`: `getFile()` returns a fresh
 * `fakeBlob` snapshot of whatever `bytes` currently holds, so a test can
 * mutate `bytes` between calls to prove this source re-reads rather than
 * caching a stale snapshot. */
function fakeHandle(bytes: Uint8Array): MinimalFileSystemFileHandle & { bytes: Uint8Array } {
  const state = { bytes };
  return {
    get bytes() {
      return state.bytes;
    },
    set bytes(next: Uint8Array) {
      state.bytes = next;
    },
    async getFile(): Promise<MinimalBlob> {
      return fakeBlob(state.bytes);
    },
  };
}

function makeFile(n: number): Uint8Array {
  return Uint8Array.from({ length: n }, (_v, i) => i % 256);
}

describe("FileSystemAccessWeightSource", () => {
  it("reports size from the handle's current File snapshot", async () => {
    const source = new FileSystemAccessWeightSource(fakeHandle(makeFile(42)));
    await expect(source.size()).resolves.toBe(42);
  });

  it("reads a full-file range starting at offset 0", async () => {
    const file = makeFile(30);
    const source = new FileSystemAccessWeightSource(fakeHandle(file));
    const out = new Uint8Array(30);
    await expect(source.read(out, 0)).resolves.toBe(30);
    expect(Array.from(out)).toEqual(Array.from(file));
  });

  it("reads a slice at a nonzero offset", async () => {
    const file = makeFile(30);
    const source = new FileSystemAccessWeightSource(fakeHandle(file));
    const out = new Uint8Array(5);
    await expect(source.read(out, 10)).resolves.toBe(5);
    expect(Array.from(out)).toEqual(Array.from(file.subarray(10, 15)));
  });

  it("returns 0 for a zero-length read without calling getFile()'s slice path", async () => {
    const handle = fakeHandle(makeFile(10));
    const source = new FileSystemAccessWeightSource(handle);
    await expect(source.read(new Uint8Array(0), 0)).resolves.toBe(0);
  });

  it("returns 0 for a read at or past end-of-file", async () => {
    const source = new FileSystemAccessWeightSource(fakeHandle(makeFile(10)));
    await expect(source.read(new Uint8Array(5), 10)).resolves.toBe(0);
    await expect(source.read(new Uint8Array(5), 1000)).resolves.toBe(0);
  });

  it("clamps a read whose destination runs past end-of-file to what remains", async () => {
    const file = makeFile(10);
    const source = new FileSystemAccessWeightSource(fakeHandle(file));
    const out = new Uint8Array(20).fill(0xff);
    await expect(source.read(out, 6)).resolves.toBe(4);
    expect(Array.from(out.subarray(0, 4))).toEqual(Array.from(file.subarray(6, 10)));
  });

  it("splits a read larger than chunkSizeBytes into multiple slice() calls and reassembles it correctly", async () => {
    const file = makeFile(25);
    const handle = fakeHandle(file);
    const sliceSpy = vi.fn<(start?: number, end?: number) => void>();
    // Wrap getFile to spy on slice() calls made against the returned blob.
    const spiedHandle: MinimalFileSystemFileHandle = {
      async getFile() {
        const blob = await handle.getFile();
        return {
          size: blob.size,
          slice: (start?: number, end?: number) => {
            sliceSpy(start, end);
            return blob.slice(start, end);
          },
          arrayBuffer: () => blob.arrayBuffer(),
        };
      },
    };
    const source = new FileSystemAccessWeightSource(spiedHandle, 10);
    const out = new Uint8Array(25);
    await expect(source.read(out, 0)).resolves.toBe(25);
    expect(Array.from(out)).toEqual(Array.from(file));
    // 25 bytes at chunkSizeBytes=10 -> three slice() calls (10, 10, 5)
    expect(sliceSpy).toHaveBeenCalledTimes(3);
    expect(sliceSpy).toHaveBeenNthCalledWith(1, 0, 10);
    expect(sliceSpy).toHaveBeenNthCalledWith(2, 10, 20);
    expect(sliceSpy).toHaveBeenNthCalledWith(3, 20, 25);
  });

  // Pins the default's *effect*, not just its existence: a read shorter than
  // the default must issue exactly one slice() spanning the whole range. An
  // earlier version of this test only asserted the constant was > 0 and that
  // size() resolved, which stayed green for any default whatsoever — including
  // a catastrophic 1-byte one that would issue a slice() per byte.
  it("chunks by DEFAULT_FSA_CHUNK_SIZE_BYTES when no chunk size is given", async () => {
    expect(DEFAULT_FSA_CHUNK_SIZE_BYTES).toBe(8 * 1024 * 1024);

    const file = makeFile(25);
    const sliceSpy = vi.fn();
    const handle = fakeHandle(file);
    const spiedHandle: MinimalFileSystemFileHandle = {
      async getFile(): Promise<MinimalBlob> {
        const blob = await handle.getFile();
        return {
          size: blob.size,
          slice(start = 0, end = blob.size): MinimalBlob {
            sliceSpy(start, end);
            return blob.slice(start, end);
          },
          arrayBuffer: () => blob.arrayBuffer(),
        };
      },
    };

    const source = new FileSystemAccessWeightSource(spiedHandle);
    const out = new Uint8Array(25);
    await expect(source.read(out, 0)).resolves.toBe(25);
    expect(Array.from(out)).toEqual(Array.from(file));
    // 25 bytes is far below the 8 MB default, so it must be a single slice.
    expect(sliceSpy).toHaveBeenCalledTimes(1);
    expect(sliceSpy).toHaveBeenNthCalledWith(1, 0, 25);
  });

  it("rejects a non-positive chunkSizeBytes at construction", () => {
    expect(() => new FileSystemAccessWeightSource(fakeHandle(makeFile(1)), 0)).toThrow(RangeError);
    expect(() => new FileSystemAccessWeightSource(fakeHandle(makeFile(1)), -5)).toThrow(RangeError);
  });

  it("re-reads the handle's current File snapshot on every call, reflecting a change between calls", async () => {
    const handle = fakeHandle(makeFile(10));
    const source = new FileSystemAccessWeightSource(handle);
    await expect(source.size()).resolves.toBe(10);
    handle.bytes = makeFile(20);
    await expect(source.size()).resolves.toBe(20);
  });

  it("serves concurrent overlapping reads into distinct destinations correctly", async () => {
    const file = makeFile(60);
    const source = new FileSystemAccessWeightSource(fakeHandle(file));
    const a = new Uint8Array(20);
    const b = new Uint8Array(20);
    const [na, nb] = await Promise.all([source.read(a, 0), source.read(b, 10)]);
    expect(na).toBe(20);
    expect(nb).toBe(20);
    expect(Array.from(a)).toEqual(Array.from(file.subarray(0, 20)));
    expect(Array.from(b)).toEqual(Array.from(file.subarray(10, 30)));
  });

  it("rejects a negative offset (delegated to clampRead)", async () => {
    const source = new FileSystemAccessWeightSource(fakeHandle(makeFile(10)));
    await expect(source.read(new Uint8Array(1), -1)).rejects.toThrow(RangeError);
  });

  it("has no close() — a plain FileSystemFileHandle read holds nothing open between calls", () => {
    // Typed as `WeightSource` for this one assertion — see
    // `memory-weight-source.test.ts`'s identical note on why.
    const source: WeightSource = new FileSystemAccessWeightSource(fakeHandle(makeFile(1)));
    expect(source.close).toBeUndefined();
  });
});

describe("pickLocalFileSystemAccessSource", () => {
  it("throws when showOpenFilePicker is not available in this environment (e.g. Node)", async () => {
    // This is the one behavior of the unverifiable-in-CI glue function that
    // *can* be honestly asserted without a real browser: Node never has
    // `showOpenFilePicker`, so this call must fail cleanly rather than
    // throwing something confusing (a bare `TypeError: ... is not a
    // function`) or hanging.
    await expect(pickLocalFileSystemAccessSource()).rejects.toThrow(/showOpenFilePicker/);
  });
});
