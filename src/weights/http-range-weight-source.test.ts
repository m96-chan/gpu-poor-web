import { describe, expect, it, vi } from "vitest";
import type { MinimalFetch, MinimalResponse } from "./browser-types.js";
import { HttpRangeWeightSource } from "./http-range-weight-source.js";
import type { WeightSource } from "./weight-source.js";

/** A fake `Response` body that streams `bytes` out in `chunkSize`-sized
 * pieces, honoring `MinimalStreamReader`'s contract (`{done, value}`, a
 * final `{done: true}` with no `value`). */
function streamingBody(bytes: Uint8Array, chunkSize: number) {
  let offset = 0;
  return {
    getReader() {
      return {
        async read() {
          if (offset >= bytes.byteLength) {
            return { done: true as const, value: undefined };
          }
          const value = bytes.subarray(offset, Math.min(offset + chunkSize, bytes.byteLength));
          offset += value.byteLength;
          return { done: false as const, value };
        },
      };
    },
  };
}

function headers(map: Record<string, string>) {
  return { get: (name: string) => map[name.toLowerCase()] ?? null };
}

/** A fake server over one fixed byte array: HEAD reports Content-Length,
 * a Range request replies 206 with the requested (inclusive) slice
 * streamed in `streamChunkSize`-sized pieces, matching real Range-request
 * semantics (RFC 7233) closely enough for this module's own logic to be
 * exercised honestly — it is not a general HTTP mock. */
function fakeRangeServer(fileBytes: Uint8Array, streamChunkSize = 3): { fetchImpl: MinimalFetch } {
  const fetchImpl: MinimalFetch = async (_url, init) => {
    if (init?.method === "HEAD") {
      return {
        status: 200,
        headers: headers({ "content-length": String(fileBytes.byteLength) }),
        body: null,
        arrayBuffer: async () => new ArrayBuffer(0),
      } satisfies MinimalResponse;
    }
    const range = init?.headers?.["Range"] ?? "";
    const match = /^bytes=(\d+)-(\d+)$/.exec(range);
    if (!match) throw new Error(`fakeRangeServer: unparsable Range header ${JSON.stringify(range)}`);
    const start = Number(match[1]);
    const end = Number(match[2]);
    const slice = fileBytes.subarray(start, end + 1);
    return {
      status: 206,
      headers: headers({ "content-range": `bytes ${start}-${end}/${fileBytes.byteLength}` }),
      body: streamingBody(slice, streamChunkSize),
      arrayBuffer: async () => slice.slice().buffer,
    } satisfies MinimalResponse;
  };
  return { fetchImpl };
}

function makeFile(n: number): Uint8Array {
  return Uint8Array.from({ length: n }, (_v, i) => i % 256);
}

describe("HttpRangeWeightSource", () => {
  it("reports size from the HEAD response's Content-Length, and caches it across calls", async () => {
    const server = fakeRangeServer(makeFile(100));
    const spy = vi.fn(server.fetchImpl);
    const source = new HttpRangeWeightSource("https://example.test/weights.bin", spy);

    await expect(source.size()).resolves.toBe(100);
    await expect(source.size()).resolves.toBe(100);

    const headCalls = spy.mock.calls.filter(([, init]) => init?.method === "HEAD");
    expect(headCalls).toHaveLength(1);
  });

  it("throws if the server's HEAD response has no usable Content-Length", async () => {
    const fetchImpl: MinimalFetch = async () =>
      ({ status: 200, headers: headers({}), body: null, arrayBuffer: async () => new ArrayBuffer(0) }) satisfies MinimalResponse;
    const source = new HttpRangeWeightSource("https://example.test/weights.bin", fetchImpl);
    await expect(source.size()).rejects.toThrow(/Content-Length/);
  });

  it("reads a full range starting at offset 0, via a 206 Range response", async () => {
    const file = makeFile(50);
    const server = fakeRangeServer(file);
    const source = new HttpRangeWeightSource("https://example.test/weights.bin", server.fetchImpl);
    const out = new Uint8Array(50);
    await expect(source.read(out, 0)).resolves.toBe(50);
    expect(Array.from(out)).toEqual(Array.from(file));
  });

  it("reads a slice at a nonzero offset, requesting exactly that byte range", async () => {
    const file = makeFile(200);
    const server = fakeRangeServer(file);
    const spy = vi.fn(server.fetchImpl);
    const source = new HttpRangeWeightSource("https://example.test/weights.bin", spy);
    const out = new Uint8Array(20);
    await expect(source.read(out, 30)).resolves.toBe(20);
    expect(Array.from(out)).toEqual(Array.from(file.subarray(30, 50)));

    const rangeCall = spy.mock.calls.find(([, init]) => init?.headers?.["Range"]);
    expect(rangeCall?.[1]?.headers?.["Range"]).toBe("bytes=30-49");
  });

  it("returns 0 without issuing a Range request for a zero-length destination", async () => {
    const server = fakeRangeServer(makeFile(50));
    const spy = vi.fn(server.fetchImpl);
    const source = new HttpRangeWeightSource("https://example.test/weights.bin", spy);
    const out = new Uint8Array(0);
    await expect(source.read(out, 0)).resolves.toBe(0);
    const rangeCalls = spy.mock.calls.filter(([, init]) => init?.headers?.["Range"]);
    expect(rangeCalls).toHaveLength(0);
  });

  it("returns 0 for a read starting at or past end-of-file, without issuing a Range request", async () => {
    const server = fakeRangeServer(makeFile(50));
    const spy = vi.fn(server.fetchImpl);
    const source = new HttpRangeWeightSource("https://example.test/weights.bin", spy);
    await expect(source.read(new Uint8Array(10), 50)).resolves.toBe(0);
    await expect(source.read(new Uint8Array(10), 1000)).resolves.toBe(0);
    const rangeCalls = spy.mock.calls.filter(([, init]) => init?.headers?.["Range"]);
    expect(rangeCalls).toHaveLength(0);
  });

  it("clamps a read whose destination runs past end-of-file to what remains", async () => {
    const file = makeFile(50);
    const server = fakeRangeServer(file);
    const source = new HttpRangeWeightSource("https://example.test/weights.bin", server.fetchImpl);
    const out = new Uint8Array(20).fill(0xff);
    await expect(source.read(out, 40)).resolves.toBe(10);
    expect(Array.from(out.subarray(0, 10))).toEqual(Array.from(file.subarray(40, 50)));
  });

  it("throws when the server responds with something other than 206 to a Range request", async () => {
    const fetchImpl: MinimalFetch = async (_url, init) => {
      if (init?.method === "HEAD") {
        return { status: 200, headers: headers({ "content-length": "10" }), body: null, arrayBuffer: async () => new ArrayBuffer(0) };
      }
      return { status: 200, headers: headers({}), body: null, arrayBuffer: async () => new ArrayBuffer(10) };
    };
    const source = new HttpRangeWeightSource("https://example.test/weights.bin", fetchImpl);
    await expect(source.read(new Uint8Array(5), 0)).rejects.toThrow(/206|Range/);
  });

  it("falls back to arrayBuffer() when the 206 response has no readable body stream", async () => {
    const file = makeFile(10);
    const fetchImpl: MinimalFetch = async (_url, init) => {
      if (init?.method === "HEAD") {
        return { status: 200, headers: headers({ "content-length": "10" }), body: null, arrayBuffer: async () => new ArrayBuffer(0) };
      }
      return { status: 206, headers: headers({}), body: null, arrayBuffer: async () => file.slice().buffer };
    };
    const source = new HttpRangeWeightSource("https://example.test/weights.bin", fetchImpl);
    const out = new Uint8Array(10);
    await expect(source.read(out, 0)).resolves.toBe(10);
    expect(Array.from(out)).toEqual(Array.from(file));
  });

  it("defensively clamps a stream that yields more bytes than were requested, instead of throwing", async () => {
    const misbehavingFile = makeFile(30);
    const fetchImpl: MinimalFetch = async (_url, init) => {
      if (init?.method === "HEAD") {
        return { status: 200, headers: headers({ "content-length": "30" }), body: null, arrayBuffer: async () => new ArrayBuffer(0) };
      }
      // Ignores the requested Range and returns the whole file — a
      // deliberately misbehaving server, to prove this doesn't corrupt or
      // overrun the caller's destination.
      return { status: 206, headers: headers({}), body: streamingBody(misbehavingFile, 7), arrayBuffer: async () => misbehavingFile.slice().buffer };
    };
    const source = new HttpRangeWeightSource("https://example.test/weights.bin", fetchImpl);
    const out = new Uint8Array(5).fill(0xaa);
    const n = await source.read(out, 0);
    expect(n).toBe(5);
    expect(Array.from(out)).toEqual(Array.from(misbehavingFile.subarray(0, 5)));
  });

  it("skips a zero-byte chunk mid-stream (a stream is allowed to yield an empty value without being done)", async () => {
    const file = makeFile(6);
    const fetchImpl: MinimalFetch = async (_url, init) => {
      if (init?.method === "HEAD") {
        return { status: 200, headers: headers({ "content-length": "6" }), body: null, arrayBuffer: async () => new ArrayBuffer(0) };
      }
      let step = 0;
      return {
        status: 206,
        headers: headers({}),
        body: {
          getReader() {
            return {
              async read() {
                step += 1;
                if (step === 1) return { done: false as const, value: file.subarray(0, 3) };
                // An empty, not-done chunk: legal per the stream contract,
                // and must not be copied into the destination or advance
                // `written` — only `continue` past it.
                if (step === 2) return { done: false as const, value: new Uint8Array(0) };
                if (step === 3) return { done: false as const, value: file.subarray(3, 6) };
                return { done: true as const, value: undefined };
              },
            };
          },
        },
        arrayBuffer: async () => file.slice().buffer,
      } satisfies MinimalResponse;
    };
    const source = new HttpRangeWeightSource("https://example.test/weights.bin", fetchImpl);
    const out = new Uint8Array(6);
    await expect(source.read(out, 0)).resolves.toBe(6);
    expect(Array.from(out)).toEqual(Array.from(file));
  });

  it("serves concurrent overlapping reads into distinct destinations correctly", async () => {
    const file = makeFile(100);
    const server = fakeRangeServer(file);
    const source = new HttpRangeWeightSource("https://example.test/weights.bin", server.fetchImpl);
    const a = new Uint8Array(10);
    const b = new Uint8Array(10);
    const [na, nb] = await Promise.all([source.read(a, 0), source.read(b, 5)]);
    expect(na).toBe(10);
    expect(nb).toBe(10);
    expect(Array.from(a)).toEqual(Array.from(file.subarray(0, 10)));
    expect(Array.from(b)).toEqual(Array.from(file.subarray(5, 15)));
  });

  it("rejects a negative offset (delegated to clampRead)", async () => {
    const server = fakeRangeServer(makeFile(10));
    const source = new HttpRangeWeightSource("https://example.test/weights.bin", server.fetchImpl);
    await expect(source.read(new Uint8Array(1), -1)).rejects.toThrow(RangeError);
  });

  it("has no close() — nothing is held open between calls", () => {
    const server = fakeRangeServer(makeFile(1));
    // Typed as `WeightSource` for this one assertion — see
    // `memory-weight-source.test.ts`'s identical note on why.
    const source: WeightSource = new HttpRangeWeightSource("https://example.test/weights.bin", server.fetchImpl);
    expect(source.close).toBeUndefined();
  });
});
