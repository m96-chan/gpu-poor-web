import { describe, expect, it } from "vitest";
import { clampRead, planChunkedRead, type WeightSource } from "./weight-source.js";

describe("clampRead", () => {
  it("reads the full requested length when it fits inside the file", () => {
    expect(clampRead(0, 10, 100)).toEqual({ offset: 0, length: 10 });
    expect(clampRead(50, 10, 100)).toEqual({ offset: 50, length: 10 });
  });

  it("clamps a read that runs past end-of-file to what remains", () => {
    expect(clampRead(90, 20, 100)).toEqual({ offset: 90, length: 10 });
    expect(clampRead(99, 1000, 100)).toEqual({ offset: 99, length: 1 });
  });

  it("returns a zero-length plan for an offset at or past end-of-file, without throwing", () => {
    expect(clampRead(100, 10, 100)).toEqual({ offset: 100, length: 0 });
    expect(clampRead(1000, 10, 100)).toEqual({ offset: 1000, length: 0 });
  });

  it("returns a zero-length plan for a zero-length request, even at a valid offset", () => {
    expect(clampRead(0, 0, 100)).toEqual({ offset: 0, length: 0 });
    expect(clampRead(50, 0, 100)).toEqual({ offset: 50, length: 0 });
  });

  it("handles an empty file (sizeBytes 0) as always zero bytes available", () => {
    expect(clampRead(0, 10, 0)).toEqual({ offset: 0, length: 0 });
    expect(clampRead(0, 0, 0)).toEqual({ offset: 0, length: 0 });
  });

  it("treats a read exactly the size of the file as a full, not clamped, read", () => {
    expect(clampRead(0, 100, 100)).toEqual({ offset: 0, length: 100 });
  });

  it("rejects a negative offset", () => {
    expect(() => clampRead(-1, 10, 100)).toThrow(RangeError);
  });

  it("rejects a non-integer offset", () => {
    expect(() => clampRead(1.5, 10, 100)).toThrow(RangeError);
  });

  it("rejects a negative requestedLength", () => {
    expect(() => clampRead(0, -1, 100)).toThrow(RangeError);
  });

  it("rejects a non-integer requestedLength", () => {
    expect(() => clampRead(0, 1.5, 100)).toThrow(RangeError);
  });

  it("rejects a negative sizeBytes", () => {
    expect(() => clampRead(0, 10, -1)).toThrow(RangeError);
  });

  it("rejects a non-integer sizeBytes", () => {
    expect(() => clampRead(0, 10, 1.5)).toThrow(RangeError);
  });
});

describe("planChunkedRead", () => {
  it("yields one sub-read when the whole range fits in one chunk", () => {
    expect(Array.from(planChunkedRead(0, 10, 64))).toEqual([{ offset: 0, length: 10 }]);
  });

  it("yields consecutive sub-reads of at most chunkSizeBytes, covering the whole range exactly once", () => {
    const parts = Array.from(planChunkedRead(100, 25, 10));
    expect(parts).toEqual([
      { offset: 100, length: 10 },
      { offset: 110, length: 10 },
      { offset: 120, length: 5 },
    ]);
  });

  it("yields exactly one sub-read when the range is an exact multiple of chunkSizeBytes", () => {
    const parts = Array.from(planChunkedRead(0, 20, 10));
    expect(parts).toEqual([
      { offset: 0, length: 10 },
      { offset: 10, length: 10 },
    ]);
  });

  it("yields no sub-reads at all for a zero-length range", () => {
    expect(Array.from(planChunkedRead(0, 0, 10))).toEqual([]);
  });

  it("rejects a zero or negative chunkSizeBytes", () => {
    expect(() => Array.from(planChunkedRead(0, 10, 0))).toThrow(RangeError);
    expect(() => Array.from(planChunkedRead(0, 10, -1))).toThrow(RangeError);
  });

  it("rejects a non-integer chunkSizeBytes", () => {
    expect(() => Array.from(planChunkedRead(0, 10, 1.5))).toThrow(RangeError);
  });

  it("covers offsets contiguously with no gap or overlap between consecutive parts", () => {
    const parts = Array.from(planChunkedRead(7, 37, 6));
    let cursor = 7;
    for (const part of parts) {
      expect(part.offset).toBe(cursor);
      cursor += part.length;
    }
    expect(cursor).toBe(7 + 37);
  });
});

describe("WeightSource (interface shape, exercised via a trivial in-line implementation)", () => {
  it("is satisfiable by a minimal object literal with size/read only — close is optional", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const source: WeightSource = {
      size: async () => bytes.byteLength,
      read: async (destination, offset) => {
        const { offset: at, length } = clampRead(offset, destination.byteLength, bytes.byteLength);
        destination.set(bytes.subarray(at, at + length));
        return length;
      },
    };

    await expect(source.size()).resolves.toBe(4);
    const out = new Uint8Array(2);
    await expect(source.read(out, 1)).resolves.toBe(2);
    expect(Array.from(out)).toEqual([2, 3]);
    expect(source.close).toBeUndefined();
  });
});
