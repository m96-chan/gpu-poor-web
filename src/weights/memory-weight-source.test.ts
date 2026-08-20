import { describe, expect, it } from "vitest";
import { InMemoryWeightSource } from "./memory-weight-source.js";
import type { WeightSource } from "./weight-source.js";

function bytesOf(...values: number[]): ArrayBuffer {
  return new Uint8Array(values).buffer;
}

describe("InMemoryWeightSource", () => {
  it("reports its size as the backing buffer's byte length", async () => {
    const source = new InMemoryWeightSource(bytesOf(1, 2, 3, 4, 5));
    await expect(source.size()).resolves.toBe(5);
  });

  it("reads a full-file range starting at offset 0", async () => {
    const source = new InMemoryWeightSource(bytesOf(10, 20, 30, 40));
    const out = new Uint8Array(4);
    await expect(source.read(out, 0)).resolves.toBe(4);
    expect(Array.from(out)).toEqual([10, 20, 30, 40]);
  });

  it("reads a slice starting at a nonzero offset", async () => {
    const source = new InMemoryWeightSource(bytesOf(10, 20, 30, 40, 50));
    const out = new Uint8Array(2);
    await expect(source.read(out, 2)).resolves.toBe(2);
    expect(Array.from(out)).toEqual([30, 40]);
  });

  it("returns 0 and leaves the destination untouched for a zero-length read", async () => {
    const source = new InMemoryWeightSource(bytesOf(1, 2, 3));
    const out = new Uint8Array(0);
    await expect(source.read(out, 0)).resolves.toBe(0);
    expect(out.byteLength).toBe(0);
  });

  it("returns 0 for a read starting exactly at end-of-file", async () => {
    const source = new InMemoryWeightSource(bytesOf(1, 2, 3));
    const out = new Uint8Array(4).fill(0xff);
    await expect(source.read(out, 3)).resolves.toBe(0);
    // destination is untouched — still all sentinel bytes
    expect(Array.from(out)).toEqual([0xff, 0xff, 0xff, 0xff]);
  });

  it("returns 0 for a read starting past end-of-file", async () => {
    const source = new InMemoryWeightSource(bytesOf(1, 2, 3));
    const out = new Uint8Array(4);
    await expect(source.read(out, 100)).resolves.toBe(0);
  });

  it("clamps a read whose destination is larger than what remains in the file", async () => {
    const source = new InMemoryWeightSource(bytesOf(1, 2, 3, 4, 5));
    const out = new Uint8Array(10).fill(0xff);
    await expect(source.read(out, 3)).resolves.toBe(2);
    expect(Array.from(out.subarray(0, 2))).toEqual([4, 5]);
    // bytes beyond what was actually read are untouched, not zeroed
    expect(Array.from(out.subarray(2))).toEqual(new Array(8).fill(0xff));
  });

  it("clamps a read whose destination is larger than the whole file", async () => {
    const source = new InMemoryWeightSource(bytesOf(7, 8));
    const out = new Uint8Array(100);
    await expect(source.read(out, 0)).resolves.toBe(2);
    expect(Array.from(out.subarray(0, 2))).toEqual([7, 8]);
  });

  it("handles an empty backing buffer: size 0, every read returns 0", async () => {
    const source = new InMemoryWeightSource(new ArrayBuffer(0));
    await expect(source.size()).resolves.toBe(0);
    const out = new Uint8Array(4);
    await expect(source.read(out, 0)).resolves.toBe(0);
  });

  it("rejects a negative offset (delegated to clampRead)", async () => {
    const source = new InMemoryWeightSource(bytesOf(1, 2, 3));
    await expect(source.read(new Uint8Array(1), -1)).rejects.toThrow(RangeError);
  });

  it("serves concurrent overlapping reads into distinct destinations correctly", async () => {
    const source = new InMemoryWeightSource(bytesOf(0, 1, 2, 3, 4, 5, 6, 7, 8, 9));
    const a = new Uint8Array(5);
    const b = new Uint8Array(5);
    const c = new Uint8Array(5);
    const [na, nb, nc] = await Promise.all([source.read(a, 0), source.read(b, 3), source.read(c, 5)]);
    expect(na).toBe(5);
    expect(nb).toBe(5);
    expect(nc).toBe(5);
    expect(Array.from(a)).toEqual([0, 1, 2, 3, 4]);
    expect(Array.from(b)).toEqual([3, 4, 5, 6, 7]);
    expect(Array.from(c)).toEqual([5, 6, 7, 8, 9]);
  });

  it("does not implement close (nothing to release for an in-memory source)", () => {
    // Typed as `WeightSource` (not the concrete class) for this one
    // assertion: `close` is optional on the interface, but a class that
    // never declares it has no `close` member at all on its own type —
    // this is checking the interface's optional-member contract, not the
    // concrete class's shape.
    const source: WeightSource = new InMemoryWeightSource(bytesOf(1));
    expect(source.close).toBeUndefined();
  });
});
