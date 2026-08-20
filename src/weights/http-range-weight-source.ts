import type { MinimalFetch, MinimalResponse } from "./browser-types.js";
import { clampRead, type WeightSource } from "./weight-source.js";

/**
 * The HTTP Range implementation (issue #1's fourth named backend). Reads a
 * remote file's bytes without ever downloading it whole, via `Range:
 * bytes=<start>-<end>` requests (RFC 7233) and a `206 Partial Content`
 * response — the same mechanism the "Llamas on the Web" paper (README's
 * prior-art survey) and every seekable-video player rely on.
 *
 * `fetchImpl` is a required constructor argument, not a `= fetch` default:
 * this repository's `tsconfig.json` deliberately excludes the `"DOM"` lib
 * (see `browser-types.ts`'s header doc), so there is no ambient `fetch`
 * identifier in scope here to default to, and — unlike the OPFS and File
 * System Access sources in this directory — there is no browser-only glue
 * function to wrap it in either: Node 24 (this repository's own
 * `engines.node`) has a spec-compatible global `fetch`, so the exact same
 * code this class runs against a real server is fully exercisable in
 * `npm test` against a fake `fetchImpl`, with no `/* v8 ignore * /`
 * anywhere in this file.
 *
 * `size()` and a Range `read()` are two logically separate requests
 * (`HEAD` vs. a `Range` GET) because a `HEAD` response's `Content-Length`
 * is the only size signal that doesn't require transferring any of the
 * file's own bytes — the same reasoning `browser-weights.ts#fetchWithProgress`
 * gives for reading `Content-Length` off the response it already has,
 * applied here to a request that fetches nothing else.
 */
export class HttpRangeWeightSource implements WeightSource {
  private cachedSizeBytes: number | undefined;

  constructor(
    private readonly url: string,
    private readonly fetchImpl: MinimalFetch,
  ) {}

  /** Cached after the first successful call: a `WeightSource.size()` is
   * documented as "may require I/O", not "always does" — repeated calls
   * (every `read()` needs the current size to clamp against) should not
   * each cost a network round trip for a value that, for the lifetime of
   * one `HttpRangeWeightSource`, is never expected to change under it (a
   * file replaced mid-download server-side is out of scope — the same
   * assumption `weight-cache.ts`'s own manifest-hash versioning makes
   * explicit for its very similar problem). */
  async size(): Promise<number> {
    if (this.cachedSizeBytes !== undefined) return this.cachedSizeBytes;
    const res = await this.fetchImpl(this.url, { method: "HEAD" });
    const contentLength = res.headers.get("content-length");
    const parsed = contentLength !== null && contentLength !== "" ? Number(contentLength) : NaN;
    if (!Number.isFinite(parsed) || parsed < 0) {
      throw new Error(
        `HttpRangeWeightSource: HEAD ${this.url} did not return a usable Content-Length header (got ${JSON.stringify(contentLength)}) — a byte-range source cannot bounds-check reads without knowing the file's size.`,
      );
    }
    this.cachedSizeBytes = parsed;
    return parsed;
  }

  async read(destination: Uint8Array, offset: number): Promise<number> {
    // `size()` is awaited before any boundary check runs (even for a
    // zero-length destination) so `offset` is always validated the same
    // way regardless of `destination.byteLength` — see `clampRead`'s own
    // contract. `size()` itself is cheap after the first call (cached
    // above), so this costs nothing beyond the first `read()`/`size()` of
    // this source's lifetime.
    const sizeBytes = await this.size();
    const { offset: at, length } = clampRead(offset, destination.byteLength, sizeBytes);
    if (length === 0) return 0;

    const end = at + length - 1; // Range end is inclusive (RFC 7233)
    const res = await this.fetchImpl(this.url, { headers: { Range: `bytes=${at}-${end}` } });
    if (res.status !== 206) {
      throw new Error(
        `HttpRangeWeightSource: ${this.url} responded HTTP ${res.status} to a Range request — the server must support byte ranges (RFC 7233, "206 Partial Content") for this source to be correct; a "200 OK" would silently deliver the whole file instead of the requested slice.`,
      );
    }

    return this.copyResponseInto(res, destination, length);
  }

  /** Copies `res`'s body into `destination`, streaming chunk-by-chunk as
   * they arrive rather than buffering the whole response first — the same
   * "never hold a second full-size copy" reasoning
   * `weight-cache.ts#readCachedFile`'s own doc gives, applied to the
   * network instead of a `ChunkStore`. `expectedLength` (== the `length`
   * `read()` already clamped to) bounds how many bytes are ever written,
   * defensively: a server or fake that ignores the requested `Range` and
   * sends back more must not overrun `destination` and turn into an
   * uncaught `RangeError` from `TypedArray#set` mid-stream — the excess is
   * silently discarded instead, the same trust decision `clampRead`
   * already makes for offset arithmetic, applied here to a streamed body
   * this class does not otherwise control. */
  private async copyResponseInto(res: MinimalResponse, destination: Uint8Array, expectedLength: number): Promise<number> {
    if (!res.body) {
      // No readable body stream (some test doubles; per the Fetch spec,
      // unusual for a 206 but not forbidden) — the one path here that
      // allocates a full-range intermediate buffer, the same trade
      // `browser-weights.ts#fetchWithProgress` makes for the same reason.
      const buffer = await res.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      const n = Math.min(bytes.byteLength, expectedLength, destination.byteLength);
      destination.set(bytes.subarray(0, n));
      return n;
    }

    const reader = res.body.getReader();
    let written = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.byteLength === 0) continue;
      const remaining = destination.byteLength - written;
      if (remaining <= 0) break;
      const slice = value.byteLength > remaining ? value.subarray(0, remaining) : value;
      destination.set(slice, written);
      written += slice.byteLength;
    }
    return written;
  }

  // No `close()`: each `read()`/`size()` is a self-contained request with
  // nothing left open between calls — unlike a sync access handle (OPFS)
  // or an open `FileSystemFileHandle` (File System Access), there is no
  // connection this source itself holds.
}
