import { describe, expect, it } from "vitest";
import type { MinimalFileSystemSyncAccessHandle } from "./browser-types.js";
import { OpfsSyncWeightSource, openOpfsSyncWeightSource } from "./opfs-sync-weight-source.js";

/** A fake `FileSystemSyncAccessHandle` honoring the (hand-written, per
 * `browser-types.ts`'s own caveat) contract: positional `read(buffer,
 * {at})` writing into the caller's buffer and returning the number of
 * bytes actually written, `getSize()`, `close()`. Tracks concurrent-call
 * depth so a test can prove `OpfsSyncWeightSource.read` never lets two
 * calls overlap inside this handle's own synchronous `read`. */
function fakeSyncAccessHandle(bytes: Uint8Array): MinimalFileSystemSyncAccessHandle & { closed: boolean; maxConcurrentReads: number } {
  const state = { closed: false, activeReads: 0, maxConcurrentReads: 0 };
  return {
    get closed() {
      return state.closed;
    },
    get maxConcurrentReads() {
      return state.maxConcurrentReads;
    },
    read(buffer, options) {
      state.activeReads += 1;
      state.maxConcurrentReads = Math.max(state.maxConcurrentReads, state.activeReads);
      const at = options?.at ?? 0;
      const view = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer instanceof ArrayBuffer ? buffer : buffer.buffer);
      const n = Math.min(view.byteLength, Math.max(0, bytes.byteLength - at));
      view.set(bytes.subarray(at, at + n));
      state.activeReads -= 1;
      return n;
    },
    getSize() {
      return bytes.byteLength;
    },
    close() {
      state.closed = true;
    },
  };
}

function makeFile(n: number): Uint8Array {
  return Uint8Array.from({ length: n }, (_v, i) => i % 256);
}

describe("OpfsSyncWeightSource", () => {
  it("reports size from the sync access handle's getSize()", async () => {
    const source = new OpfsSyncWeightSource(fakeSyncAccessHandle(makeFile(64)));
    await expect(source.size()).resolves.toBe(64);
  });

  it("reads a full-file range starting at offset 0, writing directly into the destination", async () => {
    const file = makeFile(32);
    const source = new OpfsSyncWeightSource(fakeSyncAccessHandle(file));
    const out = new Uint8Array(32);
    await expect(source.read(out, 0)).resolves.toBe(32);
    expect(Array.from(out)).toEqual(Array.from(file));
  });

  it("reads a slice at a nonzero offset", async () => {
    const file = makeFile(32);
    const source = new OpfsSyncWeightSource(fakeSyncAccessHandle(file));
    const out = new Uint8Array(8);
    await expect(source.read(out, 16)).resolves.toBe(8);
    expect(Array.from(out)).toEqual(Array.from(file.subarray(16, 24)));
  });

  it("returns 0 for a zero-length read without calling the handle's read()", async () => {
    const handle = fakeSyncAccessHandle(makeFile(10));
    const source = new OpfsSyncWeightSource(handle);
    await expect(source.read(new Uint8Array(0), 0)).resolves.toBe(0);
  });

  it("returns 0 for a read at or past end-of-file", async () => {
    const source = new OpfsSyncWeightSource(fakeSyncAccessHandle(makeFile(10)));
    await expect(source.read(new Uint8Array(5), 10)).resolves.toBe(0);
    await expect(source.read(new Uint8Array(5), 1000)).resolves.toBe(0);
  });

  it("clamps a read whose destination runs past end-of-file to what remains", async () => {
    const file = makeFile(10);
    const source = new OpfsSyncWeightSource(fakeSyncAccessHandle(file));
    const out = new Uint8Array(20).fill(0xff);
    await expect(source.read(out, 7)).resolves.toBe(3);
    expect(Array.from(out.subarray(0, 3))).toEqual(Array.from(file.subarray(7, 10)));
  });

  it("throws if the handle reports reading fewer bytes than the clamped plan expected", async () => {
    const shortHandle: MinimalFileSystemSyncAccessHandle = {
      read: () => 3, // always under-reports, regardless of what was asked
      getSize: () => 100,
      close: () => {},
    };
    const source = new OpfsSyncWeightSource(shortHandle);
    await expect(source.read(new Uint8Array(10), 0)).rejects.toThrow(/expected to read/);
  });

  it("serves concurrent overlapping reads into distinct destinations correctly, and never overlaps calls into the handle itself", async () => {
    const file = makeFile(50);
    const handle = fakeSyncAccessHandle(file);
    const source = new OpfsSyncWeightSource(handle);
    const a = new Uint8Array(10);
    const b = new Uint8Array(10);
    const c = new Uint8Array(10);
    const [na, nb, nc] = await Promise.all([source.read(a, 0), source.read(b, 10), source.read(c, 20)]);
    expect(na).toBe(10);
    expect(nb).toBe(10);
    expect(nc).toBe(10);
    expect(Array.from(a)).toEqual(Array.from(file.subarray(0, 10)));
    expect(Array.from(b)).toEqual(Array.from(file.subarray(10, 20)));
    expect(Array.from(c)).toEqual(Array.from(file.subarray(20, 30)));
    expect(handle.maxConcurrentReads).toBe(1);
  });

  it("rejects a negative offset (delegated to clampRead)", async () => {
    const source = new OpfsSyncWeightSource(fakeSyncAccessHandle(makeFile(10)));
    await expect(source.read(new Uint8Array(1), -1)).rejects.toThrow(RangeError);
  });

  it("close() delegates to the handle's own close()", async () => {
    const handle = fakeSyncAccessHandle(makeFile(1));
    const source = new OpfsSyncWeightSource(handle);
    expect(handle.closed).toBe(false);
    await source.close();
    expect(handle.closed).toBe(true);
  });
});

describe("openOpfsSyncWeightSource", () => {
  it("throws when navigator.storage is not available in this environment (e.g. Node)", async () => {
    // The one behavior of the unverifiable-in-CI glue function that *can*
    // be honestly asserted without a real browser: Node has no
    // `navigator`, so this must fail cleanly rather than throwing a bare
    // "Cannot read properties of undefined".
    await expect(openOpfsSyncWeightSource("weights.bin")).rejects.toThrow(/navigator\.storage/);
  });
});
